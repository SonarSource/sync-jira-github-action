/*
 * Copyright (C) 2019-2020 SonarSource SA
 * All rights reserved
 * mailto:info AT sonarsource DOT com
 */

/****************************************************************************************
 *
 * This file is not the one used by the Github Action in production.
 * It needs to be compiled with ./build.sh
 * The result of the compilation in the folder ./dist must be commited with the sources.
 *
 ****************************************************************************************/

const core = require('@actions/core');
const github = require('@actions/github');
const uniq = require('lodash.uniq');
const Jira = require('./Jira');

const githubToken = core.getInput('github-token', { required: true });
const jiraLogin = core.getInput('jira-login', { required: true });
const jiraPassword = core.getInput('jira-password', { required: true });
const jiraUrl = core.getInput('jira-url', { required: true });
const jiraProject = core.getInput('jira-project', { required: true });
const jiraInProgressField = parseInt(core.getInput('jira-field-inprogress', { required: true }));
const jiraInReviewField = parseInt(core.getInput('jira-field-inreview', { required: true }));
const jiraInTestField = parseInt(core.getInput('jira-field-intest', { required: true }));
const jiraResolvedField = parseInt(core.getInput('jira-field-resolved', { required: true }));
const octokit = new github.GitHub(githubToken);
const jira = new Jira({ baseUrl: jiraUrl, email: jiraLogin, token: jiraPassword });

const { payload } = github.context;
const { pull_request } = payload;

async function run() {
  try {
    let newStatus;
    core.info(`Received action "${payload.action}"`);

    const labels = pull_request.labels.map(x => x.name);
    if (
      labels.includes('common-branch') &&
      !(payload.action === 'closed' && pull_request.merged && pull_request.base.ref === 'master')
    ) {
      core.info('Detected common-branch label - not performing any change');
      return;
    }

    switch (payload.action) {
      case 'opened':
      case 'reopened':
      case 'synchronize':
      case 'review_request_removed':
        newStatus = pull_request.requested_reviewers.length <= 0 ? 'In Progress' : 'In Review';
        break;
      case 'review_requested':
        newStatus = 'In Review';
        break;
      case 'submitted':
        if (payload.review.state === 'approved') {
          newStatus = 'In Test';
        }
        break;
      case 'closed':
        if (pull_request.merged && pull_request.base.ref === 'master') {
          newStatus = 'Resolved';
        }
        break;
      default:
        core.info('Received payload:', JSON.stringify(payload, undefined, 2));
    }

    if (!newStatus) {
      core.info('No new status to set.');
      return;
    }

    const tickets = await fetchJiraTickets();

    if (tickets.length <= 0) {
      core.info('No tickets to update.');
      return;
    }

    const updatableTickets = await filterUpdatableJiraTickets(tickets);

    const ticketsThatNeedsTransition = updatableTickets.filter(
      ticket => ticket.status.name !== newStatus
    );

    if (ticketsThatNeedsTransition.length <= 0) {
      core.info('No tickets to update.');
      return;
    }

    await transitionJiraTickets(ticketsThatNeedsTransition, newStatus);
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function fetchJiraTickets() {
  core.info('Fetch all commits...');
  const response = await octokit.pulls.listCommits({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: pull_request.number
  });
  const commits = response.data;
  core.info(`Fetched all commits: ${commits.length} commits found.`);
  core.debug(`Search for tickets "${jiraProject}-XYZ" in commit messages:`);
  const tickets = commits
    .map(({ commit }) => {
      core.debug(`   - ${commit.message}`);
      const matchResult = commit.message.match(new RegExp('^' + jiraProject + '-[0-9]+'));
      return matchResult && matchResult[0];
    })
    .filter(Boolean);
  core.debug(`Tickets found in commit messages: ${tickets.join(', ')}`);

  core.debug(`Search for tickets in PR title: ${pull_request.title}`);
  // Use negative lookbehind ?<! to make sure we won't match WWWSC-125 when jiraProject is "SC"
  const ticketsInPRTitle =
    pull_request.title.match(new RegExp('(?<![a-zA-Z])' + jiraProject + '-[0-9]+', 'g')) || [];
  core.debug(`Tickets found in PR title: ${ticketsInPRTitle.join(', ')}`);

  const uniqTickets = uniq([...tickets, ...ticketsInPRTitle]);
  core.info(`${uniqTickets.length} unique tickets found: ${uniqTickets.join(', ')}`);
  return uniqTickets;
}

async function filterUpdatableJiraTickets(tickets) {
  core.info('Fetch JIRA tickets details...');
  const jiraIssues = await Promise.all(tickets.map(ticket => jira.getIssue(ticket)));
  const filteredJiraIssues = jiraIssues
    .map(issue => ({
      assignee: issue.fields.assignee && issue.fields.assignee.name,
      id: issue.id,
      key: issue.key,
      status: issue.fields.status,
      subtasks: issue.fields.subtasks
    }))
    .filter(issues => issues.subtasks.length <= 0);

  core.info(
    `Fetch tickets details: ${jiraIssues.length} jira tickets found, and ${filteredJiraIssues.length} without subtasks`
  );
  core.info(
    'Jira tickets without sub-tasks: ' +
      filteredJiraIssues.map(ticket => `${ticket.key} [${ticket.status.name}]`).join(', ')
  );
  return filteredJiraIssues;
}

// These magic numbers are the transition id's that needs to be done on the ticket to reach the status used as the key
// To check the existing transitions do a GET request to https://jira.sonarsource.com/rest/api/2/issue/SC-XXX/transitions
const transitionsMap = {
  'In Progress': jiraInProgressField,
  'In Review': jiraInReviewField,
  'In Test': jiraInTestField,
  Resolved: jiraResolvedField
};

function transitionJiraTickets(jiraTickets, newStatus) {
  core.info(`Start transitioning ${jiraTickets.length} JIRA tickets...`);
  return Promise.all(
    jiraTickets.map(ticket =>
      jira
        .transitionIssue(ticket.id, {
          transition: { id: transitionsMap[newStatus] },
          ...(newStatus === 'Resolved' && { fields: { resolution: { name: 'Done' } } })
        })
        .then(
          () => {
            core.info(
              `   - ${ticket.key} transition from status "${ticket.status.name}" to "${newStatus}" SUCCESSFUL`
            );

            if (newStatus === 'In Progress' && ticket.assignee) {
              assignJiraTicket(ticket, ticket.assignee);
            }
          },
          () => {
            core.warning(
              `   - ${ticket.key} transition from status "${ticket.status.name}" to "${newStatus}" FAILED`
            );
          }
        )
    )
  );
}

function assignJiraTicket(ticket, assignee) {
  return jira.assignIssue(ticket.id, assignee).then(
    () => {
      core.info(`   - ${ticket.key} re-assign to "${assignee}" SUCCESSFUL`);
    },
    error => {
      core.warning(`   - ${ticket.key} re-assign to "${assignee}" FAILED`);
      core.warning(error);
    }
  );
}

run();

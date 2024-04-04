# Synchronize JIRA Tickets

## Description

**Disclaimer: this JIRA automation can be skipped by adding the `common-branch` label to Pull Request.**

This GitHub action transitions JIRA tickets according to the change of the pull request status, based on the following logic:

When we receive a PR event we try to:

- When the PR is `opened` or `synchronize`
  - And there is no reviewer -> change ticket status to "In Progress"
  - And there is at least one reviewer -> change ticket status to "In Review"
- When a there is `review_requested` on the PR -> change ticket status to "In Review"
- When a review is `submitted` and `approved` -> change ticket status to "In Test"
- When the PR is `closed` and `merged` on `master` branch -> change ticket status to "Resolved"

If there is a status change to do:

- We retrieve all commits of the PR and parse their title to find all SC-\* tickets.
- We also parse the PR title to find SC-\* tickets.
- We filter those tickets to keep only those **without any subtask**
- We filter those remaining tickets to keep only those with a different status than the target.
- We transition the remaining tickets to the new status
- For "In Progress" status only: we re-assign the ticket to the original owner

## Usage

Example of GitHub Action workflow:

```yaml
name: Synchronize JIRA
on:
  pull_request_review:
    types: [submitted]
  pull_request:
    types: [opened, reopened, synchronize, review_requested, review_request_removed, closed]

jobs:
  sync-jira-tickets:
    runs-on: ubuntu-latest
    name: Synchronize JIRA tickets of PR
    steps:
      - name: Synchronized JIRA tickets based on PR status
        uses: SonarSource/sync-jira-github-action@master
        with:
          github-token: ${{ secrets.GITHUB_ORG_TOKEN }}
          jira-login: ${{ fromJSON(steps.secrets.outputs.vault).JIRA_LOGIN }}
          jira-password: ${{ fromJSON(steps.secrets.outputs.vault).JIRA_PASSWORD }}
          jira-project: SC
          jira-field-inprogress: 4
          jira-field-inreview: 721
          jira-field-intest: 731
          jira-field-resolved: 5
```

## Contribute

Changes are to be done in the `index.js` and `Jira.js` files. After modification, a production build must be generated using the `npm run build` command. The `npm run watch` command can also be used while developing to update the build on every change.
The build generates a file in the `./dist` folder that must be committed and pushed.

## How to validate changes

It's possible to test and validate changes before merging to master by using the following steps:

- Build this action using `npm run build`, commit it and push it on your branch
- Create a branch on sonarcloud-core or any other repo that use this action
- Update this action's yaml file on your new branch to use `SonarSource/sync-jira-github-action@your-branch-name` instead of `SonarSource/sync-jira-github-action@master`
- Also create an empty commit starting by a ticket number that you want to use to test the action
- Push everything on your branch and create a PR for it
- The new github action should run and you should be able to see the logs in the "Actions" tab of the PR
  - Once on the action's log you can easily re-run it and enable the debug logs
  - You can also update the action in this repo, rebuild it, push and re-run the action on the sonarcloud-core repo, it will use the latest changes

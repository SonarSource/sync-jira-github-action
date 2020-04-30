const fetch = require('node-fetch');

const serviceName = 'jira';
const { format } = require('url');

async function client(state, apiMethod = 'unknown') {
  const response = await fetch(state.req.url, state.req);

  state.res = {
    headers: response.headers.raw(),
    status: response.status
  };

  state.res.body = await response.text();

  const isJSON = (response.headers.get('content-type') || '').includes('application/json');

  if (isJSON && state.res.body) {
    state.res.body = JSON.parse(state.res.body);
  }

  if (!response.ok) {
    throw new Error(response.statusText);
  }

  return state;
}

class Jira {
  constructor({ baseUrl, token, email }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.email = email;
  }

  async getIssue(issueId, query = {}) {
    const { fields = [], expand = [] } = query;

    try {
      return this.fetch('getIssue', {
        pathname: `/rest/api/2/issue/${issueId}`,
        query: {
          fields: fields.join(','),
          expand: expand.join(',')
        }
      });
    } catch (error) {
      if (error && error.res && error.res.status === 404) {
        return;
      }

      throw error;
    }
  }

  async getIssueTransitions(issueId) {
    return this.fetch(
      'getIssueTransitions',
      { pathname: `/rest/api/2/issue/${issueId}/transitions` },
      { method: 'GET' }
    );
  }

  async transitionIssue(issueId, data) {
    return this.fetch(
      'transitionIssue',
      { pathname: `/rest/api/2/issue/${issueId}/transitions` },
      { method: 'POST', body: data }
    );
  }

  async assignIssue(issueId, name) {
    return this.fetch(
      'assignIssue',
      { pathname: `/rest/api/2/issue/${issueId}/assignee` },
      { method: 'PUT', body: { name } }
    );
  }

  async fetch(apiMethodName, { host, pathname, query }, { method, body, headers = {} } = {}) {
    const url = format({ host: host || this.baseUrl, pathname, query });

    if (!method) {
      method = 'GET';
    }

    if (headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (headers.Authorization === undefined) {
      headers.Authorization = `Basic ${Buffer.from(`${this.email}:${this.token}`).toString(
        'base64'
      )}`;
    }

    // strong check for undefined
    // cause body variable can be 'false' boolean value
    if (body && headers['Content-Type'] === 'application/json') {
      body = JSON.stringify(body);
    }

    const state = {
      req: {
        method,
        headers,
        body,
        url
      }
    };

    await client(state, `${serviceName}:${apiMethodName}`);

    return state.res.body;
  }
}

module.exports = Jira;

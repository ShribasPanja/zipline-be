export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubWebhookPayload {
  ref: string;
  before: string;
  after: string;
  repository: {
    name: string;
    full_name: string;
    clone_url: string;
    html_url: string;
    private: boolean;
    id: number;
  };
  head_commit: {
    message: string;
    id: string;
    author: {
      name: string;
      email: string;
    };
  };
  pusher: {
    name: string;
    email: string;
  };
  commits?: Array<{
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  }>;
}

export interface GitHubAuthUrlParams {
  client_id: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
}

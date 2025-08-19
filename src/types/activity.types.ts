export interface Activity {
  id: string;
  type: "push" | "webhook_setup" | "pipeline_execution";
  timestamp: Date;
  repository: {
    name: string;
    full_name: string;
  };
  commit?: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  };
  pusher?: {
    name: string;
    email: string;
  };
  user?: {
    id: string;
    login: string;
    name?: string;
    email?: string;
  };
  status: "success" | "failed" | "in_progress";
  metadata?: Record<string, any>;
}

export interface ActivityFilter {
  type?: string;
  repository?: string;
  userId?: string;
  userLogin?: string;
  limit?: number;
  offset?: number;
}

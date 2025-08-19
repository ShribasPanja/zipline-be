import { Activity, ActivityFilter } from "../types/activity.types";

export class ActivityService {
  private static activities: Activity[] = [];

  static addActivity(activity: Omit<Activity, "id" | "timestamp">): Activity {
    const newActivity: Activity = {
      ...activity,
      id: this.generateId(),
      timestamp: new Date(),
    };

    this.activities.unshift(newActivity); // Add to beginning for newest first

    // Keep only last 100 activities to prevent memory issues
    if (this.activities.length > 100) {
      this.activities = this.activities.slice(0, 100);
    }

    console.log(
      `[INFO] Added new activity: ${newActivity.type} for ${newActivity.repository.name}`
    );
    return newActivity;
  }

  static getActivities(filter: ActivityFilter = {}): Activity[] {
    let filtered = [...this.activities];

    // Apply filters
    if (filter.type) {
      filtered = filtered.filter((activity) => activity.type === filter.type);
    }

    if (filter.repository) {
      filtered = filtered.filter(
        (activity) =>
          activity.repository.full_name === filter.repository ||
          activity.repository.name === filter.repository
      );
    }

    if (filter.userId) {
      filtered = filtered.filter(
        (activity) => activity.user?.id === filter.userId
      );
    }

    if (filter.userLogin) {
      filtered = filtered.filter(
        (activity) => activity.user?.login === filter.userLogin
      );
    }

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 20;

    return filtered.slice(offset, offset + limit);
  }

  static getRecentActivities(limit: number = 10, userId?: string): Activity[] {
    let filtered = [...this.activities];

    // Filter by user if userId is provided
    if (userId) {
      filtered = filtered.filter((activity) => activity.user?.id === userId);
    }

    return filtered.slice(0, limit);
  }

  static clearActivities(): void {
    this.activities = [];
    console.log("[INFO] Cleared all activities");
  }

  static seedSampleActivities(): void {
    // Add some sample activities for demonstration
    this.addActivity({
      type: "webhook_setup",
      repository: {
        name: "demo-app",
        full_name: "user/demo-app",
      },
      status: "success",
      metadata: {
        webhook_url: `${process.env.NGROK_URL}/webhook/github`,
        events: ["push"],
      },
    });

    this.addActivity({
      type: "push",
      repository: {
        name: "demo-app",
        full_name: "user/demo-app",
      },
      commit: {
        id: "abc123def456",
        message: "Fix authentication bug and update docs",
        author: {
          name: "John Doe",
          email: "john@example.com",
        },
      },
      pusher: {
        name: "John Doe",
        email: "john@example.com",
      },
      status: "success",
      metadata: {
        ref: "refs/heads/main",
        commits_count: 2,
      },
    });

    this.addActivity({
      type: "pipeline_execution",
      repository: {
        name: "demo-app",
        full_name: "user/demo-app",
      },
      status: "success",
      metadata: {
        trigger: "push",
        duration: "2m 34s",
        commit_id: "abc123def456",
      },
    });

    console.log("[INFO] Seeded sample activities");
  }

  static async addPipelineExecutionActivity(
    activityData: Omit<Activity, "id" | "timestamp" | "user">,
    repoFullName?: string
  ): Promise<Activity> {
    let user: Activity["user"] = undefined;

    // Try to get user info from repository owner if available
    if (repoFullName) {
      try {
        const { RepositoryOwnerRepository } = await import(
          "../repositories/repositoryOwner.repository"
        );
        const repoOwner = await RepositoryOwnerRepository.findByRepoFullName(
          repoFullName
        );
        if (repoOwner) {
          user = {
            id: repoOwner.userId,
            login: repoOwner.userLogin,
            name: repoOwner.userName || undefined,
            email: repoOwner.userEmail || undefined,
          };
        }
      } catch (error) {
        console.warn(
          "[ACTIVITY] Could not get repository owner for activity:",
          error
        );
      }
    }

    return this.addActivity({
      ...activityData,
      user,
    });
  }

  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

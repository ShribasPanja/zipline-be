// Local minimal contract to avoid coupling with docker.service types
export interface StepLike {
  name: string;
  image: string;
  run: string;
  needs?: string[];
  artifacts?: {
    paths: string[];
    name?: string;
    expire?: string;
  };
}

export interface StepNode {
  step: StepLike;
  status: "pending" | "queued" | "running" | "completed" | "failed";
  dependencies: string[];
  dependents: string[];
  queuedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface DAGExecutionPlan {
  nodes: Map<string, StepNode>;
  initialSteps: string[];
  totalSteps: number;
}

export class PipelineOrchestrator {
  static buildExecutionPlan(steps: StepLike[]): DAGExecutionPlan {
    const nodes = new Map<string, StepNode>();
    const initialSteps: string[] = [];

    for (const step of steps) {
      nodes.set(step.name, {
        step,
        status: "pending",
        dependencies: step.needs || [],
        dependents: [],
      });
    }

    for (const step of steps) {
      const node = nodes.get(step.name)!;
      if (!step.needs || step.needs.length === 0) {
        initialSteps.push(step.name);
      } else {
        for (const dep of step.needs) {
          const depNode = nodes.get(dep);
          if (!depNode) {
            throw new Error(
              `Step "${step.name}" depends on "${dep}" which does not exist`
            );
          }
          depNode.dependents.push(step.name);
        }
      }
    }

    this.validateDAG(nodes);

    return { nodes, initialSteps, totalSteps: steps.length };
  }

  private static validateDAG(nodes: Map<string, StepNode>) {
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (name: string): boolean => {
      if (stack.has(name)) return true;
      if (visited.has(name)) return false;
      visited.add(name);
      stack.add(name);
      const node = nodes.get(name);
      if (node) {
        for (const dep of node.dependencies) {
          if (dfs(dep)) return true;
        }
      }
      stack.delete(name);
      return false;
    };

    for (const name of nodes.keys()) {
      if (dfs(name)) {
        throw new Error(
          `Circular dependency detected in pipeline involving step: ${name}`
        );
      }
    }
  }

  static getReadySteps(plan: DAGExecutionPlan): string[] {
    const ready: string[] = [];
    for (const [name, node] of plan.nodes) {
      if (node.status === "pending") {
        const depsDone = node.dependencies.every((d) => {
          const dep = plan.nodes.get(d);
          return dep?.status === "completed";
        });
        if (depsDone) ready.push(name);
      }
    }
    return ready;
  }

  static updateStepStatus(
    plan: DAGExecutionPlan,
    stepName: string,
    status: StepNode["status"],
    error?: string
  ): string[] {
    const node = plan.nodes.get(stepName);
    if (!node) throw new Error(`Step "${stepName}" not found in plan`);
    node.status = status;
    if (error) node.error = error;
    switch (status) {
      case "queued":
        node.queuedAt = new Date();
        break;
      case "running":
        node.startedAt = new Date();
        break;
      case "completed":
      case "failed":
        node.completedAt = new Date();
        break;
    }

    if (status === "failed") {
      this.markDependentsFailed(plan, stepName);
      return [];
    }
    if (status === "completed") {
      return this.getReadySteps(plan);
    }
    return [];
  }

  private static markDependentsFailed(
    plan: DAGExecutionPlan,
    failedStep: string
  ) {
    const queue = [...(plan.nodes.get(failedStep)?.dependents || [])];
    const seen = new Set<string>();
    while (queue.length) {
      const name = queue.shift()!;
      if (seen.has(name)) continue;
      seen.add(name);
      const node = plan.nodes.get(name);
      if (node && node.status === "pending") {
        node.status = "failed";
        node.error = `Dependency "${failedStep}" failed`;
        node.completedAt = new Date();
        queue.push(...node.dependents);
      }
    }
  }

  static isPipelineComplete(plan: DAGExecutionPlan): boolean {
    for (const n of plan.nodes.values()) {
      if (n.status !== "completed" && n.status !== "failed") return false;
    }
    return true;
  }

  static isPipelineSuccessful(plan: DAGExecutionPlan): boolean {
    for (const n of plan.nodes.values()) {
      if (n.status !== "completed") return false;
    }
    return true;
  }

  static getExecutionStats(plan: DAGExecutionPlan) {
    const stats = {
      total: plan.totalSteps,
      pending: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    for (const n of plan.nodes.values()) {
      (stats as any)[n.status]++;
    }
    return stats;
  }
}

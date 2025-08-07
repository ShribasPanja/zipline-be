import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execPromise = promisify(exec);

interface Step {
  name: string;
  image: string;
  run: string;
}

interface StepResult {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

export class DockerExecutionService {
  static async validateDockerAvailability(): Promise<boolean> {
    try {
      await execPromise("docker --version");
      console.log("[DOCKER] Docker is available");
      return true;
    } catch (error) {
      console.error("[DOCKER] Docker is not available:", error);
      return false;
    }
  }

  static async executeStep(
    step: Step,
    workingDir: string
  ): Promise<StepResult> {
    const stepStartTime = Date.now();
    console.log(`[DOCKER] --- Executing Step: "${step.name}" ---`);

    try {
      // Check if Docker is available
      const dockerAvailable = await this.validateDockerAvailability();
      if (!dockerAvailable) {
        throw new Error("Docker is not available on the system");
      }

      const command = `docker run --rm -v "${workingDir}:/app" -w /app ${step.image} ${step.run}`;
      console.log(`[DOCKER] Running command: ${command}`);

      const { stdout, stderr } = await execPromise(command, {
        cwd: workingDir,
        timeout: 300000, // 5 minutes timeout
      });

      const stepDuration = Date.now() - stepStartTime;

      if (stderr && stderr.trim() !== "") {
        console.warn(`[DOCKER_WARN] Step "${step.name}" stderr: ${stderr}`);
      }

      console.log(`[DOCKER] Step "${step.name}" completed successfully`);
      console.log(stdout);

      return {
        name: step.name,
        success: true,
        output: stdout,
        duration: stepDuration,
      };
    } catch (stepError: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(
        `[DOCKER_ERROR] Step "${step.name}" failed:`,
        stepError.message
      );

      return {
        name: step.name,
        success: false,
        error: stepError.message,
        duration: stepDuration,
      };
    }
  }

  static async executePipelineSteps(
    steps: Step[],
    workingDir: string
  ): Promise<{
    success: boolean;
    steps: StepResult[];
    error?: string;
  }> {
    const results: StepResult[] = [];

    console.log(
      `[DOCKER] Starting execution of ${steps.length} pipeline steps`
    );

    for (const step of steps) {
      const result = await this.executeStep(step, workingDir);
      results.push(result);

      // Stop execution if step failed
      if (!result.success) {
        console.error(
          `[DOCKER] Pipeline execution stopped due to failed step: ${step.name}`
        );
        return {
          success: false,
          steps: results,
          error: `Pipeline failed at step "${step.name}": ${result.error}`,
        };
      }
    }

    console.log(
      `[DOCKER] All ${steps.length} pipeline steps completed successfully`
    );
    return {
      success: true,
      steps: results,
    };
  }
}

import { spawn, exec } from "child_process";
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
    workingDir: string,
    onOutput?: (output: string, isError?: boolean) => void
  ): Promise<StepResult> {
    const stepStartTime = Date.now();
    console.log(`[DOCKER] --- Executing Step: "${step.name}" ---`);

    try {
      // Check if Docker is available
      const dockerAvailable = await this.validateDockerAvailability();
      if (!dockerAvailable) {
        throw new Error("Docker is not available on the system");
      }

      return new Promise<StepResult>((resolve, reject) => {
        const args = [
          "run",
          "--rm",
          "-v",
          `${workingDir}:/app`,
          "-w",
          "/app",
          step.image,
          "sh",
          "-c",
          `set -e\n${step.run}`, // Add 'set -e' to exit on any command failure
        ];

        console.log(
          `[DOCKER] Running: docker ${args
            .slice(0, -2)
            .join(" ")} sh -c "set -e; ${step.run}"`
        );
        onOutput?.(
          `[DOCKER] Starting step "${step.name}" with image ${step.image}`,
          false
        );

        const dockerProcess = spawn("docker", args, {
          cwd: workingDir,
          stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout and stderr piped
        });

        let stdout = "";
        let stderr = "";

        // Handle stdout stream
        dockerProcess.stdout?.on("data", (data: Buffer) => {
          const output = data.toString();
          stdout += output;
          console.log(`[DOCKER_OUT] ${step.name}: ${output.trim()}`);
          onOutput?.(output, false);
        });

        // Handle stderr stream
        dockerProcess.stderr?.on("data", (data: Buffer) => {
          const output = data.toString();
          stderr += output;
          console.warn(`[DOCKER_ERR] ${step.name}: ${output.trim()}`);
          onOutput?.(output, true);
        });

        let processCompleted = false; // Prevent multiple resolutions

        // Handle process exit
        dockerProcess.on(
          "exit",
          (code: number | null, signal: string | null) => {
            if (processCompleted) return;
            processCompleted = true;

            const stepDuration = Date.now() - stepStartTime;
            console.log(
              `[DOCKER] Process exited with code: ${code}, signal: ${signal}`
            );

            if (code === 0) {
              console.log(
                `[DOCKER] Step "${step.name}" completed successfully (exit code: ${code})`
              );
              onOutput?.(
                `[DOCKER] Step "${step.name}" completed successfully`,
                false
              );
              resolve({
                name: step.name,
                success: true,
                output: stdout,
                duration: stepDuration,
              });
            } else {
              // Step failed with non-zero exit code - REJECT the promise!
              const errorMessage =
                stderr.trim() || `Process exited with code ${code}`;
              console.error(
                `[FATAL] Step "${step.name}" failed with exit code: ${code}`
              );
              console.error(`[DOCKER_ERROR] Error output: ${errorMessage}`);
              onOutput?.(
                `[DOCKER] Step "${step.name}" failed with exit code: ${code}`,
                true
              );
              onOutput?.(`[DOCKER] Error: ${errorMessage}`, true);

              // REJECT the promise to stop pipeline execution
              reject(
                new Error(
                  `Step "${step.name}" failed with exit code ${code}: ${errorMessage}`
                )
              );
            }
          }
        );

        // Handle process completion (backup in case exit doesn't fire)
        dockerProcess.on("close", (code: number | null) => {
          if (processCompleted) return;
          processCompleted = true;

          const stepDuration = Date.now() - stepStartTime;

          console.log(`[DOCKER] Process closed with exit code: ${code}`);

          if (code === 0) {
            console.log(
              `[DOCKER] Step "${step.name}" completed successfully (exit code: ${code})`
            );
            onOutput?.(
              `[DOCKER] Step "${step.name}" completed successfully`,
              false
            );
            resolve({
              name: step.name,
              success: true,
              output: stdout,
              duration: stepDuration,
            });
          } else {
            // Step failed with non-zero exit code - REJECT the promise!
            const errorMessage =
              stderr.trim() || `Process exited with code ${code}`;
            console.error(
              `[FATAL] Step "${step.name}" failed with exit code: ${code}`
            );
            console.error(`[DOCKER_ERROR] Error output: ${errorMessage}`);
            onOutput?.(
              `[DOCKER] Step "${step.name}" failed with exit code: ${code}`,
              true
            );
            onOutput?.(`[DOCKER] Error: ${errorMessage}`, true);

            // REJECT the promise to stop pipeline execution
            reject(
              new Error(
                `Step "${step.name}" failed with exit code ${code}: ${errorMessage}`
              )
            );
          }
        });

        // Handle process errors
        dockerProcess.on("error", (error: Error) => {
          if (processCompleted) return;
          processCompleted = true;

          const stepDuration = Date.now() - stepStartTime;
          console.error(
            `[FATAL] Failed to start step process "${step.name}":`,
            error.message
          );
          onOutput?.(`[DOCKER] Process error: ${error.message}`, true);

          // REJECT the promise for process errors
          reject(
            new Error(`Failed to start step "${step.name}": ${error.message}`)
          );
        });

        // Set a timeout for the process (5 minutes)
        const timeout = setTimeout(() => {
          console.warn(
            `[DOCKER] Step "${step.name}" timed out, killing process`
          );
          onOutput?.(`[DOCKER] Step "${step.name}" timed out`, true);
          dockerProcess.kill("SIGTERM");

          // Force kill after 10 seconds if still running
          setTimeout(() => {
            if (!dockerProcess.killed) {
              dockerProcess.kill("SIGKILL");
            }
          }, 10000);
        }, 300000); // 5 minutes

        // Clear timeout when process completes
        dockerProcess.on("close", () => {
          clearTimeout(timeout);
        });
      });
    } catch (stepError: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(
        `[DOCKER_ERROR] Step "${step.name}" failed:`,
        stepError.message
      );
      onOutput?.(`[DOCKER] Error: ${stepError.message}`, true);

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
    workingDir: string,
    onOutput?: (output: string, isError?: boolean) => void,
    executionId?: string // Add executionId for database updates
  ): Promise<{
    success: boolean;
    steps: StepResult[];
    error?: string;
  }> {
    const results: StepResult[] = [];

    console.log(
      `[DOCKER] Starting execution of ${steps.length} pipeline steps`
    );
    onOutput?.(
      `[DOCKER] Starting execution of ${steps.length} pipeline steps`,
      false
    );

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        onOutput?.(
          `\n[DOCKER] === Step ${i + 1}/${steps.length}: "${step.name}" ===`,
          false
        );

        try {
          const result = await this.executeStep(step, workingDir, onOutput);
          // If we reach here, the step succeeded (no rejection)
          results.push(result);

          console.log(`[DOCKER] Step "${step.name}" completed successfully`);

          onOutput?.(
            `[DOCKER] Step "${step.name}" completed successfully\n`,
            false
          );
        } catch (stepError: any) {
          // Handle step failures (rejected promises)
          const stepResult: StepResult = {
            name: step.name,
            success: false,
            error: stepError.message,
            duration: 0,
          };
          results.push(stepResult);

          const errorMessage = stepError.message;
          console.error(`[FATAL] Pipeline execution stopped: ${errorMessage}`);
          onOutput?.(errorMessage, true);

          // Update database with failure
          if (executionId) {
            try {
              const { PipelineRunRepository } = await import(
                "../repositories/pipelineRun.repository"
              );
              await PipelineRunRepository.updateByExecutionId(executionId, {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: errorMessage,
              });
              console.log(
                `[DOCKER] Updated database with failure for execution: ${executionId}`
              );
            } catch (dbError) {
              console.error(`[DOCKER] Failed to update database: ${dbError}`);
            }
          }

          // Re-throw to stop pipeline
          throw new Error(errorMessage);
        }
      }

      console.log(
        `[DOCKER] All ${steps.length} pipeline steps completed successfully`
      );
      onOutput?.(
        `[DOCKER] All ${steps.length} pipeline steps completed successfully`,
        false
      );

      return {
        success: true,
        steps: results,
      };
    } catch (pipelineError: any) {
      // Top-level pipeline error handling
      console.error(
        `[DOCKER] Pipeline execution failed: ${pipelineError.message}`
      );

      return {
        success: false,
        steps: results,
        error: pipelineError.message,
      };
    }
  }
}

import { spawn, exec, ChildProcess } from "child_process";
import { promisify } from "util";
import path from "path";

const execPromise = promisify(exec);

interface Step {
  name: string;
  image: string;
  run: string;
  env?: string[];
}

interface StepResult {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

const activeDockerProcesses = new Map<string, ChildProcess[]>();

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

  static killProcessesForExecution(executionId: string): number {
    const processes = activeDockerProcesses.get(executionId);
    if (!processes || processes.length === 0) {
      console.log(
        `[DOCKER_CANCEL] No active processes found for execution ${executionId}`
      );
      return 0;
    }

    let killedCount = 0;
    for (const process of processes) {
      try {
        if (!process.killed) {
          process.kill("SIGTERM");
          killedCount++;
          console.log(
            `[DOCKER_CANCEL] Killed Docker process ${process.pid} for execution ${executionId}`
          );
        }
      } catch (error) {
        console.error(
          `[DOCKER_CANCEL] Failed to kill process ${process.pid}:`,
          error
        );
      }
    }

    activeDockerProcesses.delete(executionId);
    console.log(
      `[DOCKER_CANCEL] Killed ${killedCount} Docker processes for execution ${executionId}`
    );
    return killedCount;
  }

  static addProcessToTracking(
    executionId: string,
    process: ChildProcess
  ): void {
    if (!activeDockerProcesses.has(executionId)) {
      activeDockerProcesses.set(executionId, []);
    }
    activeDockerProcesses.get(executionId)!.push(process);
  }

  static removeProcessFromTracking(
    executionId: string,
    process: ChildProcess
  ): void {
    const processes = activeDockerProcesses.get(executionId);
    if (processes) {
      const index = processes.indexOf(process);
      if (index > -1) {
        processes.splice(index, 1);
      }
      if (processes.length === 0) {
        activeDockerProcesses.delete(executionId);
      }
    }
  }

  static async executeStep(
    step: Step,
    workingDir: string,
    onOutput?: (output: string, isError?: boolean) => void,
    secretEnvVars?: string[],
    executionId?: string
  ): Promise<StepResult> {
    const stepStartTime = Date.now();
    console.log(`[DOCKER] --- Executing Step: "${step.name}" ---`);

    try {
      const dockerAvailable = await this.validateDockerAvailability();
      if (!dockerAvailable) {
        throw new Error("Docker is not available on the system");
      }

      return new Promise<StepResult>((resolve, reject) => {
        const args = ["run", "--rm", "-v", `${workingDir}:/app`, "-w", "/app"];

        if (secretEnvVars && secretEnvVars.length > 0) {
          for (const envVar of secretEnvVars) {
            args.push("-e", envVar);
          }
          console.log(
            `[DOCKER] Injecting ${secretEnvVars.length} secret environment variables`
          );
        }

        if (step.env && step.env.length > 0) {
          for (const envVar of step.env) {
            args.push("-e", envVar);
          }
          console.log(
            `[DOCKER] Adding ${step.env.length} step environment variables`
          );
        }

        args.push(
          step.image,
          "sh",
          "-c",
          `set -e\n${step.run}`
        );

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
          stdio: ["ignore", "pipe", "pipe"],
        });

        if (executionId) {
          this.addProcessToTracking(executionId, dockerProcess);
        }

        let stdout = "";
        let stderr = "";

        dockerProcess.stdout?.on("data", (data: Buffer) => {
          const output = data.toString();
          stdout += output;
          console.log(`[DOCKER_OUT] ${step.name}: ${output.trim()}`);
          onOutput?.(output, false);
        });

        dockerProcess.stderr?.on("data", (data: Buffer) => {
          const output = data.toString();
          stderr += output;
          console.warn(`[DOCKER_ERR] ${step.name}: ${output.trim()}`);
          onOutput?.(output, true);
        });

        let processCompleted = false;

        dockerProcess.on(
          "exit",
          (code: number | null, signal: string | null) => {
            if (processCompleted) return;
            processCompleted = true;

            if (executionId) {
              this.removeProcessFromTracking(executionId, dockerProcess);
            }

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
              if (signal === "SIGTERM") {
                console.log(`[DOCKER] Step "${step.name}" was cancelled`);
                onOutput?.(`[DOCKER] Step "${step.name}" was cancelled`, true);
                reject(new Error(`Step "${step.name}" was cancelled`));
                return;
              }

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

              reject(
                new Error(
                  `Step "${step.name}" failed with exit code ${code}: ${errorMessage}`
                )
              );
            }
          }
        );

        dockerProcess.on("close", (code: number | null) => {
          if (processCompleted) return;
          processCompleted = true;

          if (executionId) {
            this.removeProcessFromTracking(executionId, dockerProcess);
          }

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

            reject(
              new Error(
                `Step "${step.name}" failed with exit code ${code}: ${errorMessage}`
              )
            );
          }
        });

        dockerProcess.on("error", (error: Error) => {
          if (processCompleted) return;
          processCompleted = true;

          const stepDuration = Date.now() - stepStartTime;
          console.error(
            `[FATAL] Failed to start step process "${step.name}":`,
            error.message
          );
          onOutput?.(`[DOCKER] Process error: ${error.message}`, true);

          reject(
            new Error(`Failed to start step "${step.name}": ${error.message}`)
          );
        });

        const timeout = setTimeout(() => {
          console.warn(
            `[DOCKER] Step "${step.name}" timed out, killing process`
          );
          onOutput?.(`[DOCKER] Step "${step.name}" timed out`, true);
          dockerProcess.kill("SIGTERM");

          setTimeout(() => {
            if (!dockerProcess.killed) {
              dockerProcess.kill("SIGKILL");
            }
          }, 10000);
        }, 300000);

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
    executionId?: string
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
          results.push(result);

          console.log(`[DOCKER] Step "${step.name}" completed successfully`);

          onOutput?.(
            `[DOCKER] Step "${step.name}" completed successfully\n`,
            false
          );
        } catch (stepError: any) {
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

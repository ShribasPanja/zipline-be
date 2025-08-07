import { readFile, mkdir, rm, readdir } from "fs/promises";
import { parse } from "yaml";
import path from "path";
import { simpleGit } from "simple-git";
import { existsSync } from "fs";

interface Step {
  name: string;
  image: string;
  run: string;
}

interface Pipeline {
  name?: string;
  description?: string;
  steps: Step[];
}

interface PipelineResult {
  success: boolean;
  error?: string;
  duration: number;
  tempDir?: string; // Add temp directory to result
  steps: {
    name: string;
    success: boolean;
    output?: string;
    error?: string;
    duration: number;
  }[];
}

export class PipelineHelper {
  private static getTempDir(repoName: string): string {
    const tempBasePath =
      process.env.PIPELINE_TEMP_DIR ||
      process.env.TEMP ||
      process.env.TMP ||
      path.join(process.cwd(), "temp");

    return path.resolve(
      tempBasePath,
      "zipline-pipelines",
      `${repoName}-${Date.now()}`
    );
  }

  private static normalizeRepoUrl(repoUrl: string): string {
    let cleanUrl = repoUrl;

    if (cleanUrl.includes("github.com")) {
      if (
        cleanUrl.startsWith("https://github.com/") &&
        !cleanUrl.endsWith(".git")
      ) {
        cleanUrl = `${cleanUrl}.git`;
      }
      if (cleanUrl.startsWith("github.com/")) {
        cleanUrl = `https://${cleanUrl}.git`;
      }
    }

    return cleanUrl;
  }

  static async executePipeline(
    repoUrl: string,
    repoName: string,
    branch?: string,
    skipCleanup: boolean = false
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const normalizedUrl = this.normalizeRepoUrl(repoUrl);
    const tempDir = this.getTempDir(repoName);

    const result: PipelineResult = {
      success: false,
      duration: 0,
      tempDir,
      steps: [],
    };

    try {
      // Ensure temp directory parent exists
      await mkdir(path.dirname(tempDir), { recursive: true });

      // Clone the repository
      const gitInstance = simpleGit({
        baseDir: path.dirname(tempDir),
        binary: "git",
        maxConcurrentProcesses: 1,
        timeout: { block: 60000 },
      });

      const cloneOptions = ["--recurse-submodules"];
      if (branch) {
        cloneOptions.push("--branch", branch);
      }

      await gitInstance.clone(normalizedUrl, tempDir, cloneOptions);

      // Verify clone success
      const clonedFiles = await readdir(tempDir);
      if (clonedFiles.length === 0) {
        throw new Error("Repository cloned but appears to be empty");
      }

      // Read and validate pipeline configuration
      const yamlPath = path.join(tempDir, ".zipline/pipeline.yml");
      if (!existsSync(yamlPath)) {
        throw new Error(
          "Pipeline configuration file (.zipline/pipeline.yml) not found in repository"
        );
      }

      const pipeline = (await this.readYamlConfig(yamlPath)) as Pipeline;
      if (!pipeline.steps || pipeline.steps.length === 0) {
        throw new Error("No steps defined in pipeline configuration");
      }

      result.success = true;
    } catch (error: any) {
      result.error = error.message;
    } finally {
      if (!skipCleanup && existsSync(tempDir)) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(`Failed to cleanup temp directory: ${cleanupError}`);
        }
      }

      result.duration = Date.now() - startTime;
    }

    return result;
  }

  static async readYamlConfig(filePath: string): Promise<Pipeline> {
    try {
      const fileContent = await readFile(filePath, "utf8");
      const config = parse(fileContent);

      if (!config || typeof config !== "object") {
        throw new Error(
          "Invalid pipeline configuration: must be a valid YAML object"
        );
      }

      if (!config.steps || !Array.isArray(config.steps)) {
        throw new Error(
          "Invalid pipeline configuration: steps must be an array"
        );
      }

      for (let i = 0; i < config.steps.length; i++) {
        const step = config.steps[i];
        if (!step.name || !step.image || !step.run) {
          throw new Error(
            `Invalid step at index ${i}: must have name, image, and run properties`
          );
        }
      }

      return config as Pipeline;
    } catch (error: any) {
      throw error;
    }
  }

  static async checkRepositoryPipelineConfig(
    repoPath: string
  ): Promise<boolean> {
    const yamlPath = path.join(repoPath, ".zipline/pipeline.yml");
    return existsSync(yamlPath);
  }
}

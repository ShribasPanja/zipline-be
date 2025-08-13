import archiver from "archiver";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

interface ArtifactConfig {
  paths: string[];
  name?: string;
  expire?: string;
}

interface UploadResult {
  success: boolean;
  artifactId?: string;
  key?: string;
  size?: number;
  error?: string;
}

export class ArtifactService {
  private s3Client: S3Client;
  private bucketName: string = "zipline-artifacts";

  constructor() {
    // Configure S3 client for MinIO
    this.s3Client = new S3Client({
      endpoint: "http://localhost:9000",
      region: "us-east-1", // MinIO requires a region, but it's ignored
      credentials: {
        accessKeyId: "admin",
        secretAccessKey: "StrongPass123",
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Save artifacts for a step if it's successful
   */
  async saveArtifacts(
    executionId: string,
    stepName: string,
    workingDir: string,
    artifactConfig: ArtifactConfig,
    isStepSuccessful: boolean
  ): Promise<UploadResult[]> {
    if (!isStepSuccessful) {
      console.log(
        `[ARTIFACT] Skipping artifact save for failed step: ${stepName}`
      );
      return [];
    }

    if (!artifactConfig.paths || artifactConfig.paths.length === 0) {
      console.log(
        `[ARTIFACT] No artifact paths configured for step: ${stepName}`
      );
      return [];
    }

    console.log(`[ARTIFACT] Saving artifacts for step: ${stepName}`);
    const results: UploadResult[] = [];

    for (const artifactPath of artifactConfig.paths) {
      try {
        const result = await this.saveArtifact(
          executionId,
          stepName,
          workingDir,
          artifactPath,
          artifactConfig.name
        );
        results.push(result);
      } catch (error: any) {
        console.error(
          `[ARTIFACT] Failed to save artifact ${artifactPath}:`,
          error.message
        );
        results.push({
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Save a single artifact by zipping it and uploading to MinIO
   */
  async saveArtifact(
    executionId: string,
    stepName: string,
    workingDir: string,
    artifactPath: string,
    customName?: string
  ): Promise<UploadResult> {
    const fullPath = path.resolve(workingDir, artifactPath);

    // Check if the artifact path exists
    try {
      await stat(fullPath);
    } catch (error) {
      throw new Error(`Artifact path not found: ${artifactPath}`);
    }

    // Generate artifact metadata
    const artifactId = uuidv4();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipFileName = customName
      ? `${customName}-${timestamp}.zip`
      : `${stepName}-${artifactId.substring(0, 8)}-${timestamp}.zip`;

    const tempZipPath = path.join(workingDir, zipFileName);

    try {
      // Create zip archive
      console.log(`[ARTIFACT] Creating zip archive: ${zipFileName}`);
      const zipSize = await this.createZipArchive(fullPath, tempZipPath);

      // Upload to MinIO
      console.log(`[ARTIFACT] Uploading to MinIO: ${zipFileName}`);
      const s3Key = `${executionId}/${stepName}/${zipFileName}`;
      await this.uploadToMinIO(tempZipPath, s3Key);

      // Clean up temporary zip file
      fs.unlinkSync(tempZipPath);

      console.log(`[ARTIFACT] Successfully saved artifact: ${s3Key}`);

      return {
        success: true,
        artifactId,
        key: s3Key,
        size: zipSize,
      };
    } catch (error: any) {
      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }
      } catch (cleanupError) {
        console.warn(`[ARTIFACT] Failed to cleanup temp file: ${cleanupError}`);
      }

      throw error;
    }
  }

  /**
   * Create a zip archive from a file or directory
   */
  private async createZipArchive(
    sourcePath: string,
    outputPath: string
  ): Promise<number> {
    return new Promise(async (resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver("zip", {
        zlib: { level: 6 }, // Compression level
      });

      let totalSize = 0;

      output.on("close", () => {
        totalSize = archive.pointer();
        console.log(`[ARTIFACT] Archive created: ${totalSize} bytes`);
        resolve(totalSize);
      });

      archive.on("error", (err) => {
        console.error(`[ARTIFACT] Archive error:`, err);
        reject(err);
      });

      archive.on("warning", (err) => {
        if (err.code === "ENOENT") {
          console.warn(`[ARTIFACT] Archive warning:`, err);
        } else {
          reject(err);
        }
      });

      archive.pipe(output);

      // Check if source is file or directory
      const stats = await stat(sourcePath);

      if (stats.isDirectory()) {
        console.log(`[ARTIFACT] Adding directory to archive: ${sourcePath}`);
        archive.directory(sourcePath, false);
      } else {
        console.log(`[ARTIFACT] Adding file to archive: ${sourcePath}`);
        archive.file(sourcePath, { name: path.basename(sourcePath) });
      }

      await archive.finalize();
    });
  }

  /**
   * Upload file to MinIO server
   */
  private async uploadToMinIO(filePath: string, key: string): Promise<void> {
    try {
      const fileStream = fs.createReadStream(filePath);
      const stats = await stat(filePath);

      const uploadParams = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileStream,
        ContentType: "application/zip",
        ContentLength: stats.size,
        Metadata: {
          "upload-time": new Date().toISOString(),
          "original-size": stats.size.toString(),
        },
      };

      const command = new PutObjectCommand(uploadParams);
      await this.s3Client.send(command);

      console.log(
        `[ARTIFACT] Successfully uploaded to MinIO: s3://${this.bucketName}/${key}`
      );
    } catch (error: any) {
      console.error(`[ARTIFACT] MinIO upload failed:`, error);
      throw new Error(`Failed to upload to MinIO: ${error.message}`);
    }
  }

  /**
   * Ensure the MinIO bucket exists (should be called during initialization)
   */
  async initializeBucket(): Promise<void> {
    try {
      // Try to create bucket (MinIO will ignore if it already exists)
      const { CreateBucketCommand, HeadBucketCommand } = await import(
        "@aws-sdk/client-s3"
      );

      try {
        // Check if bucket exists
        await this.s3Client.send(
          new HeadBucketCommand({ Bucket: this.bucketName })
        );
        console.log(`[ARTIFACT] Bucket '${this.bucketName}' already exists`);
      } catch (error: any) {
        if (error.name === "NotFound") {
          // Bucket doesn't exist, create it
          await this.s3Client.send(
            new CreateBucketCommand({ Bucket: this.bucketName })
          );
          console.log(`[ARTIFACT] Created bucket: ${this.bucketName}`);
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      console.error(`[ARTIFACT] Failed to initialize bucket:`, error.message);
      throw error;
    }
  }

  /**
   * Get artifact download URL (for future use)
   */
  async getArtifactUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });
      return signedUrl;
    } catch (error: any) {
      console.error(`[ARTIFACT] Failed to generate download URL:`, error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  /**
   * List artifacts for an execution
   */
  async listArtifacts(executionId: string): Promise<any[]> {
    try {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");

      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: `${executionId}/`,
      });

      const response = await this.s3Client.send(command);

      return (response.Contents || []).map((obj) => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        executionId: executionId,
        stepName: obj.Key?.split("/")[1],
        fileName: obj.Key?.split("/").pop(),
      }));
    } catch (error: any) {
      console.error(`[ARTIFACT] Failed to list artifacts:`, error);
      throw new Error(`Failed to list artifacts: ${error.message}`);
    }
  }
}

export default ArtifactService;

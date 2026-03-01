const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const simpleGit = require("simple-git");
const AdmZip = require("adm-zip");

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");

// Ensure deployments directory exists
if (!fs.existsSync(DEPLOYMENTS_DIR)) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
}

// Auto-detect framework from directory contents
const detectFramework = (dir) => {
  const result = { framework: "static", buildCommand: "", outputDir: "dist" };
  const packageJsonPath = path.join(dir, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return result; // No package.json = static site
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Detect React
    if (allDeps["react"] || allDeps["react-dom"]) {
      result.framework = "react";

      // Detect build tool and set build command + output dir
      if (allDeps["vite"] || allDeps["@vitejs/plugin-react"]) {
        result.buildCommand = "npm run build";
        result.outputDir = "dist";
      } else if (allDeps["react-scripts"]) {
        result.buildCommand = "npm run build";
        result.outputDir = "build";
      } else if (allDeps["next"]) {
        result.buildCommand = "npm run build";
        result.outputDir = "out";
      } else {
        result.buildCommand = "npm run build";
        result.outputDir = "dist";
      }
    } else if (allDeps["vite"] || allDeps["parcel"] || allDeps["webpack"]) {
      // Has a bundler but not React
      result.framework = "other";
      result.buildCommand = "npm run build";
      result.outputDir = allDeps["parcel"] ? "dist" : "dist";
    } else if (pkg.scripts && pkg.scripts.build) {
      // Has a build script
      result.framework = "other";
      result.buildCommand = "npm run build";
      result.outputDir = "dist";
    }
    // else: has package.json but no build tooling = static
  } catch {
    // If package.json is malformed, treat as static
  }

  return result;
};

const deployFromGit = async (project) => {
  const projectDir = path.join(DEPLOYMENTS_DIR, project._id.toString());
  const srcDir = path.join(projectDir, "_src");
  let logs = "";

  try {
    // Clean previous deployment
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    // Clone repository
    logs += `[CLONE] Cloning ${project.gitUrl} (branch: ${project.branch})...\n`;
    const git = simpleGit();
    await git.clone(project.gitUrl, srcDir, [
      "--branch",
      project.branch,
      "--depth",
      "1",
    ]);
    logs += `[CLONE] Repository cloned successfully.\n`;

    // Auto-detect framework
    const detected = detectFramework(srcDir);
    project.framework = detected.framework;
    if (!project.buildCommand || project.buildCommand === "") {
      project.buildCommand = detected.buildCommand;
    }
    if (!project.outputDir || project.outputDir === "dist") {
      project.outputDir = detected.outputDir;
    }
    logs += `[DETECT] Framework: ${detected.framework} | Build: ${project.buildCommand || "none"} | Output: ${project.outputDir}\n`;

    // Install dependencies if package.json exists
    const packageJsonPath = path.join(srcDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      logs += `[BUILD] Installing dependencies...\n`;
      try {
        execSync("npm install", {
          cwd: srcDir,
          timeout: 120000,
          stdio: "pipe",
        });
        logs += `[BUILD] Dependencies installed.\n`;
      } catch (e) {
        logs += `[BUILD] npm install warning: ${e.message}\n`;
      }
    }

    // Run build command if specified
    if (project.buildCommand && project.buildCommand.trim()) {
      logs += `[BUILD] Running: ${project.buildCommand}\n`;
      try {
        const output = execSync(project.buildCommand, {
          cwd: srcDir,
          timeout: 180000,
          stdio: "pipe",
          env: { ...process.env, CI: "false" },
        });
        logs += `[BUILD] Build completed.\n`;
        if (output) logs += output.toString().slice(-500) + "\n";
      } catch (e) {
        logs += `[BUILD] Build error: ${e.stderr ? e.stderr.toString().slice(-500) : e.message}\n`;
        throw new Error("Build failed");
      }
    }

    // Copy output to serve directory
    const outputSrc = project.buildCommand
      ? path.join(srcDir, project.outputDir || "dist")
      : srcDir;

    const serveDir = path.join(projectDir, "serve");

    if (fs.existsSync(outputSrc)) {
      copyDirSync(outputSrc, serveDir);
      logs += `[DEPLOY] Files copied to serve directory.\n`;
    } else {
      // Fallback: serve srcDir directly
      copyDirSync(srcDir, serveDir);
      logs += `[DEPLOY] No build output found, serving source directly.\n`;
    }

    // Clean up src to save space
    if (fs.existsSync(srcDir)) {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }

    logs += `[DEPLOY] Deployment successful!\n`;
    return { success: true, logs };
  } catch (error) {
    logs += `[ERROR] ${error.message}\n`;
    return { success: false, logs };
  }
};

const deployFromUpload = async (project, zipFilePath) => {
  const projectDir = path.join(DEPLOYMENTS_DIR, project._id.toString());
  const serveDir = path.join(projectDir, "serve");
  let logs = "";

  try {
    // Clean previous deployment
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(serveDir, { recursive: true });

    logs += `[UPLOAD] Extracting uploaded archive...\n`;

    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(serveDir, true);

    // Check if zip contained a single root folder
    const entries = fs.readdirSync(serveDir);
    if (entries.length === 1) {
      const singleEntry = path.join(serveDir, entries[0]);
      if (fs.statSync(singleEntry).isDirectory()) {
        // Move contents up one level
        const innerFiles = fs.readdirSync(singleEntry);
        for (const file of innerFiles) {
          fs.renameSync(
            path.join(singleEntry, file),
            path.join(serveDir, file),
          );
        }
        fs.rmdirSync(singleEntry);
        logs += `[UPLOAD] Unwrapped single root directory.\n`;
      }
    }

    logs += `[UPLOAD] Files extracted successfully.\n`;

    // Auto-detect framework from extracted files
    const detected = detectFramework(serveDir);
    project.framework = detected.framework;
    logs += `[DETECT] Framework: ${detected.framework}\n`;

    // Clean up the uploaded zip
    if (fs.existsSync(zipFilePath)) {
      fs.unlinkSync(zipFilePath);
    }

    logs += `[DEPLOY] Deployment successful!\n`;
    return { success: true, logs };
  } catch (error) {
    logs += `[ERROR] ${error.message}\n`;
    return { success: false, logs };
  }
};

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const getServeDir = (projectId) => {
  return path.join(DEPLOYMENTS_DIR, projectId.toString(), "serve");
};

const deleteDeployment = (projectId) => {
  const projectDir = path.join(DEPLOYMENTS_DIR, projectId.toString());
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
};

module.exports = {
  deployFromGit,
  deployFromUpload,
  getServeDir,
  deleteDeployment,
  detectFramework,
  DEPLOYMENTS_DIR,
};

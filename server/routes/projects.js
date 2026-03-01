const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Project = require("../models/Project");
const { protect } = require("../middleware/auth");
const {
  deployFromGit,
  deployFromUpload,
  getServeDir,
  deleteDeployment,
} = require("../utils/deploy");

// Multer config for zip uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed" ||
      file.originalname.endsWith(".zip")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip files are allowed"), false);
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// Helper to generate slug
const generateSlug = (name) => {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-" +
    Date.now().toString(36)
  );
};

// GET /api/projects - list user's projects
router.get("/", protect, async (req, res) => {
  try {
    const projects = await Project.find({ owner: req.user._id }).sort({
      updatedAt: -1,
    });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/projects/:id - get single project
router.get("/:id", protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/projects/git - create project from git
router.post("/git", protect, async (req, res) => {
  try {
    const { name, description, gitUrl, branch, buildCommand, outputDir } =
      req.body;

    if (!name || !gitUrl) {
      return res
        .status(400)
        .json({ message: "Project name and Git URL are required." });
    }

    const slug = generateSlug(name);
    const project = await Project.create({
      name,
      slug,
      description: description || "",
      owner: req.user._id,
      deployType: "git",
      gitUrl,
      branch: branch || "main",
      buildCommand: buildCommand || "",
      outputDir: outputDir || "dist",
      framework: "static", // auto-detected during deploy
      status: "building",
    });

    // Deploy asynchronously
    (async () => {
      try {
        const result = await deployFromGit(project);
        project.logs = result.logs;
        project.status = result.success ? "live" : "failed";
        project.lastDeployed = result.success ? new Date() : null;
        await project.save();
      } catch (err) {
        project.status = "failed";
        project.logs = `[ERROR] ${err.message}`;
        await project.save();
      }
    })();

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/projects/upload - create project from zip upload
router.post("/upload", protect, upload.single("file"), async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !req.file) {
      return res
        .status(400)
        .json({ message: "Project name and zip file are required." });
    }

    const slug = generateSlug(name);
    const project = await Project.create({
      name,
      slug,
      description: description || "",
      owner: req.user._id,
      deployType: "upload",
      framework: "static", // auto-detected during deploy
      status: "building",
    });

    // Deploy
    const result = await deployFromUpload(project, req.file.path);
    project.logs = result.logs;
    project.status = result.success ? "live" : "failed";
    project.lastDeployed = result.success ? new Date() : null;
    await project.save();

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/projects/:id/redeploy - redeploy a project
router.post("/:id/redeploy", protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    project.status = "building";
    project.logs = "";
    await project.save();

    if (project.deployType === "git") {
      (async () => {
        try {
          const result = await deployFromGit(project);
          project.logs = result.logs;
          project.status = result.success ? "live" : "failed";
          project.lastDeployed = result.success ? new Date() : null;
          await project.save();
        } catch (err) {
          project.status = "failed";
          project.logs = `[ERROR] ${err.message}`;
          await project.save();
        }
      })();
    }

    res.json({ message: "Redeployment started.", project });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/projects/:id
router.delete("/:id", protect, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    deleteDeployment(project._id);
    await Project.findByIdAndDelete(project._id);

    res.json({ message: "Project deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

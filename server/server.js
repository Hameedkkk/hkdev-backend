require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const { getServeDir } = require("./utils/deploy");
const Project = require("./models/Project");

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);

// Serve deployed sites via /sites/:slug
app.use("/sites/:slug", async (req, res, next) => {
  try {
    const project = await Project.findOne({
      slug: req.params.slug,
      status: "live",
    });
    if (!project) {
      return res
        .status(404)
        .json({ message: "Site not found or not yet deployed." });
    }

    const serveDir = getServeDir(project._id);
    if (!fs.existsSync(serveDir)) {
      return res.status(404).json({ message: "Deployment files not found." });
    }

    // Serve static files from the project's serve directory
    express.static(serveDir, { extensions: ["html"] })(req, res, () => {
      // SPA fallback - serve index.html for any unmatched routes
      const indexPath = path.join(serveDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("File not found");
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Server error serving site." });
  }
});

// Serve the React client in production
if (process.env.NODE_ENV === "production") {
  const clientBuild = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientBuild));
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientBuild, "index.html"));
  });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", name: "HKDEV", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║     HKDEV Deployment Platform        ║
  ║     Server running on port ${PORT}      ║
  ╚══════════════════════════════════════╝
  `);
});

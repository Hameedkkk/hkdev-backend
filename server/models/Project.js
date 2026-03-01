const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Project name is required"],
      trim: true,
      maxlength: 50,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: 200,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deployType: {
      type: String,
      enum: ["git", "upload"],
      required: true,
    },
    gitUrl: {
      type: String,
      default: "",
    },
    branch: {
      type: String,
      default: "main",
    },
    buildCommand: {
      type: String,
      default: "",
    },
    outputDir: {
      type: String,
      default: "dist",
    },
    status: {
      type: String,
      enum: ["pending", "building", "live", "failed"],
      default: "pending",
    },
    lastDeployed: {
      type: Date,
      default: null,
    },
    logs: {
      type: String,
      default: "",
    },
    framework: {
      type: String,
      enum: ["react", "static", "other"],
      default: "static",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Project", projectSchema);

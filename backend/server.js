const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const express = require("express");
const fs = require("fs");
const helmet = require("helmet");
const mongoose = require("mongoose");
const path = require("path");

dotenv.config();
const { uploadDir } = require("./config/storage");

const requiredEnv = ["MONGODB_URI", "JWT_SECRET"];
if (process.env.NODE_ENV === "production") {
  requiredEnv.push("VISITOR_HASH_SECRET");
}
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app = express();
const isProduction = process.env.NODE_ENV === "production";
fs.mkdirSync(uploadDir, { recursive: true });

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));

const postsRouter = require("./routes/posts");
const nodesRouter = require("./routes/nodes");
const uploadRouter = require("./routes/upload");
const authRouter = require("./routes/auth");

app.use("/api/posts", postsRouter);
app.use("/api/nodes", nodesRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/auth", authRouter);

app.use((req, res, next) => {
  const blockedPaths = ["/package.json", "/package-lock.json"];
  if (
    blockedPaths.includes(req.path) ||
    req.path.startsWith("/node_modules/") ||
    req.path.startsWith("/backend/")
  ) {
    return res.status(404).send("Not found.");
  }
  return next();
});

app.get("/uploads/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const extension = path.extname(filename).toLowerCase();
  const allowedImages = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

  if (
    filename !== req.params.filename ||
    !/^[a-zA-Z0-9._-]+$/.test(filename) ||
    !allowedImages.has(extension)
  ) {
    return res.status(400).send("Invalid image.");
  }

  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Image not found.");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=604800");
  return res.sendFile(filePath);
});

app.get("/health", (req, res) => {
  res.json({
    status: mongoose.connection.readyState === 1 ? "ok" : "degraded",
  });
});

app.use(
  express.static(path.join(__dirname, "../frontend"), {
    etag: true,
    maxAge: isProduction ? "7d" : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.use((req, res) => {
  if (
    req.method === "GET" &&
    req.accepts("html") &&
    req.path !== "/" &&
    path.extname(req.path) === ""
  ) {
    return res.sendFile(path.join(__dirname, "../frontend/page.html"));
  }
  if (req.method === "GET" && req.accepts("html")) {
    return res.status(404).sendFile(path.join(__dirname, "../frontend/404.html"));
  }
  return res.status(404).json({ message: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);

  if (err.name === "MulterError") {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ message: `Upload error: ${err.message}` });
  }

  const status = err.status || 500;
  return res.status(status).json({
    message: isProduction ? "Server error." : err.message,
  });
});

const PORT = process.env.PORT || 8080;

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };

// webpack.config.js
const path        = require("path");
const CopyPlugin  = require("copy-webpack-plugin");
const HtmlPlugin  = require("html-webpack-plugin");

module.exports = {
  /* ---------- ENTRY ---------- */
  entry: "./src/main.ts",

  /* ---------- OUTPUT ---------- */
  output: {
    path:     path.resolve(__dirname, "dist"),
    filename: "bundle.js",
    publicPath: ""          // keep paths relative
  },

  /* ---------- RESOLVE ---------- */
  resolve: {
    extensions: [".ts", ".js", ".json", ".wasm"],
    alias: {
      /*  👇  EXACT glue-file name that lives in wasm-utils/pkg  */
      "wasm-utils": path.resolve(__dirname, "wasm-utils/pkg/wasm_utils.js")
    }
  },

  /* ---------- LOADERS ---------- */
  module: {
    rules: [
      { test: /\.css$/,  use: ["style-loader", "css-loader"] },
      { test: /\.ts$/,   use: "ts-loader", exclude: /node_modules/ },
      { test: /\.wasm$/, type: "asset/resource" }
    ]
  },

  /* ---------- PLUGINS ---------- */
  plugins: [
    new HtmlPlugin({ template: "./index.html", inject: false }),
    new CopyPlugin({
      patterns: [
        { from: "wasm-utils/pkg/*.wasm", to: "[name][ext]", noErrorOnMissing: true }, // copy optional WASM binary
        { from: "img",                  to: "img" },         // copy images
        { from: "config",               to: "config" },      // copy runtime config and i18n files
        { from: "index.css",            to: "." },           // copy root stylesheet
        { from: "public",               to: "." },           // copy Cloudflare Pages metadata
        { from: "CNAME",                to: "." }            // copy custom-domain hint for static hosts
      ]
    })
  ],

  /* ---------- WEBASSEMBLY ---------- */
  experiments: { asyncWebAssembly: true },

  /* ---------- MODE ---------- */
  mode: process.env.NODE_ENV === "production" ? "production" : "development"
};

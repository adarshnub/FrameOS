import { writeFile } from "node:fs/promises";

const arguments_ = process.argv.slice(2);
const value = (name) => arguments_[arguments_.indexOf(name) + 1];
const output = value("--output-file");
if (!output || !value("--model") || !value("--file")) process.exit(2);
process.stderr.write("whisper_print_progress_callback: progress = 50%\n");
await writeFile(
  `${output}.json`,
  JSON.stringify({
    result: { language: "en" },
    transcription: [
      {
        timestamps: { from: "00:00:00,000", to: "00:00:01,250" },
        offsets: { from: 0, to: 1250 },
        text: " FrameOS transcript",
        tokens: [
          {
            text: " FrameOS",
            offsets: { from: 0, to: 700 },
            p: 0.9,
          },
          {
            text: " transcript",
            offsets: { from: 700, to: 1250 },
            p: 0.8,
          },
        ],
      },
    ],
  }),
  "utf8",
);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input.trim());
  if (request.parameters.mode === "hang") {
    setInterval(() => {}, 1_000);
    return;
  }
  if (request.parameters.mode === "oversize") {
    process.stdout.write("x".repeat(4_096));
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      requestId: request.requestId,
      type: "progress",
      progress: 0.5,
      message: "fixture halfway",
    })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      requestId: request.requestId,
      type: "result",
      outputType: "transcript",
      segments: [
        {
          range: {
            start: { value: 0, rate: { numerator: 1_000, denominator: 1 } },
            duration: {
              value: 1_500,
              rate: { numerator: 1_000, denominator: 1 },
            },
          },
          text: request.parameters.text ?? "Fixture transcript",
          labels: ["speech"],
          confidence: 0.99,
          metadata: { wordTimestamps: true },
        },
      ],
      metadata: {
        assetHash: request.asset.hash,
        modelProvided: typeof request.modelPath === "string",
        resourceRoles: request.resources.map((resource) => resource.role),
        secretVisible: process.env.FRAMEOS_TEST_SECRET !== undefined,
      },
    })}\n`,
  );
});

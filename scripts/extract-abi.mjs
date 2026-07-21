import fs from "node:fs";
import solc from "solc";

const sourcePath = "contracts/BasePassDaily.sol";
const outputPath = "src/abi/basePassDaily.ts";
const source = fs.readFileSync(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "BasePassDaily.sol": {
      content: source,
    },
  },
  settings: {
    outputSelection: {
      "*": {
        "*": ["abi"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors?.filter((item) => item.severity === "error") ?? [];

if (errors.length > 0) {
  console.error(errors.map((item) => item.formattedMessage).join("\n"));
  process.exit(1);
}

const abi = output.contracts["BasePassDaily.sol"].BasePassDaily.abi;
const file = `export const basePassDailyAbi = ${JSON.stringify(abi, null, 2)} as const;\n`;

fs.writeFileSync(outputPath, file);
console.log(`Wrote ${outputPath}`);

// Diagnostic utility for Claude CLI presence and environment
export async function run(
  cmd: string,
  ...args: string[]
): Promise<{ code: number; out: string; err: string }> {
  try {
    const c = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
    const { code, stdout, stderr, success } = await c.output();
    const td = new TextDecoder();
    return {
      code: typeof code === "number" ? code : success ? 0 : 1,
      out: td.decode(stdout).trim(),
      err: td.decode(stderr).trim(),
    };
  } catch (e) {
    return {
      code: -1,
      out: "",
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  // env
  let cwd = "unknown";
  try {
    cwd = Deno.cwd();
  } catch {
    // no-op
  }

  let pathEnv = "";
  try {
    pathEnv = Deno.env.get("PATH") ?? "";
  } catch {
    pathEnv = "";
  }
  const pathParts = pathEnv.split(":").filter(Boolean);
  const head = pathParts.slice(0, 3);

  let shell = "unknown";
  try {
    shell = Deno.env.get("SHELL") ?? "unknown";
  } catch {
    // ignore
  }

  console.log(`cwd=${cwd}`);
  if (head[0]) console.log(`PATH[0]=${head[0]}`);
  if (head[1]) console.log(`PATH[1]=${head[1]}`);
  if (head[2]) console.log(`PATH[2]=${head[2]}`);
  console.log(`shell=${shell}`);

  const whichRes = await run("which", "claude");
  const whichValue =
    whichRes.code === 0 && whichRes.out ? whichRes.out : "not_found";
  console.log(`which claude: ${whichValue}`);

  let versionValue = "not_found_or_failed";
  if (whichValue !== "not_found") {
    const v = await run("claude", "--version");
    if (v.code === 0 && v.out) {
      versionValue = v.out.split("\n")[0].trim();
    }
  }
  console.log(`claude --version: ${versionValue}`);
}

if (import.meta.main) {
  await main();
}

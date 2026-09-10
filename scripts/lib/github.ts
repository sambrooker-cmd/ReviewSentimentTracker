import { Octokit } from "@octokit/rest";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getRepoInfo(): { owner: string; repo: string } {
  // GITHUB_REPOSITORY ("owner/repo") is set automatically inside GitHub Actions.
  const repo = requiredEnv("GITHUB_REPOSITORY");
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

export async function fileAlertIssue(title: string, body: string, labels: string[] = ["alert"]): Promise<string> {
  const token = requiredEnv("GITHUB_TOKEN");
  const octokit = new Octokit({ auth: token });
  const { owner, repo } = getRepoInfo();

  const { data: issue } = await octokit.issues.create({ owner, repo, title, body, labels });
  return issue.html_url;
}

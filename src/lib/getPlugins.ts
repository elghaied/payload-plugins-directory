import { GitHubContent, GitHubRepo, PackageJson, Plugin } from "../types";

export const extractMajorVersions = (version: string): number[] => {
  const versionRanges = version.split("||").map((v) => v.trim());
  const majorVersions = new Set<number>();

  versionRanges.forEach((range) => {
    const cleanVersion = range.replace(/[\^~]/, "");
    const betaMatch = cleanVersion.match(/^(\d+)\.0\.0(?:-beta|$)/);
    if (betaMatch) {
      majorVersions.add(parseInt(betaMatch[1]));
      return;
    }

    const match = cleanVersion.match(/^(\d+)\./);
    if (match) {
      majorVersions.add(parseInt(match[1]));
    }
  });

  return Array.from(majorVersions);
};

export const getPayloadVersion = (packageJson: PackageJson): string | null => {
  return (
    packageJson.peerDependencies?.payload ||
    packageJson.dependencies?.payload ||
    packageJson.devDependencies?.payload ||
    null
  );
};

export const fetchPackageJsonContent = async (
  repo: GitHubRepo,
  path: string
): Promise<PackageJson | null> => {
  try {
    const packageJsonUrl = `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${repo.default_branch}/${path}/package.json`;
 
    const response = await fetch(packageJsonUrl);
    return response.ok ? await response.json() : null;
  } catch (err) {
    console.error(`Error fetching package.json from ${path}:`, err);
    return null;
  }
};

export const fetchPluginDetails = async (repo: GitHubRepo): Promise<Plugin[]> => {
  try {
    const rootPackageJson = await fetchPackageJsonContent(repo, "");
    const plugins: Plugin[] = [];

    if (rootPackageJson) {
      const payloadVersion = getPayloadVersion(rootPackageJson);
      if (payloadVersion) {
        plugins.push({
          id: `${repo.id}-root`,
          name: repo.name.replace(/-/g, " "),
          description: repo.description || "No description available",
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          lastUpdate: repo.pushed_at,
          owner: repo.owner.login,
          url: repo.html_url,
          topics: repo.topics || [],
          isOfficial: repo.owner.login.toLowerCase() === "payloadcms",
          payloadVersion,
          payloadVersionMajor: extractMajorVersions(payloadVersion),
        });
      } else {
        const packagePlugins = await fetchPackagesDirectory(repo);
        for (const pkg of packagePlugins) {
          const payloadVersion = getPayloadVersion(pkg.packageJson);
          if (payloadVersion) {
            plugins.push({
              id: `${repo.id}-${pkg.name}`,
              name: `${pkg.name.replace(/-/g, " ")}`,
              collection: `${repo.name}`,
              description: pkg.packageJson.description || "No description available",
              stars: repo.stargazers_count,
              forks: repo.forks_count,
              lastUpdate: repo.pushed_at,
              owner: repo.owner.login,
              url: `${repo.html_url}/tree/${repo.default_branch}/${pkg.path}`,
              topics: repo.topics || [],
              isOfficial: repo.owner.login.toLowerCase() === "payloadcms",
              payloadVersion,
              payloadVersionMajor: extractMajorVersions(payloadVersion),
            });
          }
        }
      }
    }

    return plugins;
  } catch (err) {
    console.error(`Error processing repo ${repo.name}:`, err);
    return [];
  }
};

interface PackagePlugin {
  name: string;
  path: string;
  packageJson: PackageJson;
}

const fetchPackagesDirectory = async (
  repo: GitHubRepo
): Promise<PackagePlugin[]> => {
  try {
    const packagesApiUrl = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/packages?ref=${repo.default_branch}`;
   
    const response = await fetch(packagesApiUrl);

    if (!response.ok) return [];

    const contents = await response.json();
    const packages: PackagePlugin[] = [];

    const directories = contents.filter(
      (item: GitHubContent) => item.type === "dir"
    );

    for (const dir of directories) {
      const packageJson = await fetchPackageJsonContent(
        repo,
        `packages/${dir.name}`
      );
      if (packageJson) {
        packages.push({
          name: dir.name,
          path: `packages/${dir.name}`,
          packageJson,
        });
      }
    }

    return packages;
  } catch (err) {
    console.error(`Error fetching packages directory for ${repo.name}:`, err);
    return [];
  }
};

export const fetchPlugins = async (): Promise<Plugin[]> => {
  try {
    const response = await fetch(
      "https://api.github.com/search/repositories?q=topic:payload-plugin+fork:true&sort=stars&order=desc&per_page=500",
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 86400 } // 24 hours
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch plugins: ${response.statusText}`);
    }

    const data = await response.json();
    const pluginsWithVersion = await Promise.all(
      data.items.map((repo: GitHubRepo) => fetchPluginDetails(repo))
    );

    return pluginsWithVersion.flat().filter(
      (plugin): plugin is Plugin =>
        plugin !== null && plugin !== undefined
    );
  } catch (err) {
    console.error("Error fetching plugins:", err);
    return [];
  }
};
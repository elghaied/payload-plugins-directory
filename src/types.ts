export interface GitHubContent {
  name: string;
  type: "dir" | "file";
  path: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  pushed_at: string;
  created_at: string;
  html_url: string;
  topics: string[];
  owner: {
    login: string;
    avatar_url: string;
  };
  default_branch: string;
  license: {
    spdx_id: string;
    name: string;
  } | null;
  open_issues_count: number;
  archived: boolean;
}

export interface PackageJson {
  name?: string;
  description?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface NpmData {
  weeklyDownloads: number;
  monthlyDownloads: number;
  latestVersion: string;
  unpackedSize: number | null;
  lastPublish: string;
  dependencyCount: number;
}

export interface Plugin {
  id: string;
  name: string;
  packageName?: string;
  collection?: string;
  description: string;
  stars: number;
  forks: number;
  lastUpdate: string;
  createdAt: string;
  owner: string;
  ownerAvatar: string;
  url: string;
  topics: string[];
  isOfficial: boolean;
  payloadVersion: string | null;
  payloadVersionMajor: number[];
  license: string | null;
  openIssues: number;
  isArchived: boolean;
  readme?: string;
  npm?: NpmData;
  healthScore?: number;
}

export interface PluginsData {
  lastUpdated: string;
  totalCount: number;
  plugins: Plugin[];
}

export type SortOption = "featured" | "stars" | "forks" | "recent" | "created" | "name" | "downloads" | "health";
export type VersionFilter = "all" | "0" | "1" | "2" | "3"; // 0 = unknown version

"use client";
import React, { useState, useEffect } from 'react';
import { Search, GitFork, Star, Clock, AlertCircle, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from "@/components/ui/badge";

interface GitHubRepo {
  id: number;
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  html_url: string;
  topics: string[];
  owner: {
    login: string;
  };
  default_branch: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Plugin {
  id: number;
  name: string;
  description: string;
  stars: number;
  forks: number;
  lastUpdate: string;
  owner: string;
  url: string;
  topics: string[];
  isOfficial: boolean;
  payloadVersion: string | null;
  payloadVersionMajor: number[] | null; 

}

type SortOption = 'stars' | 'forks' | 'recent';
type VersionFilter = 'all' | '1' | '2' | '3';

const isWithinLastSevenMonths = (dateString: string): boolean => {
    const date = new Date(dateString);
    const sevenMonthsAgo = new Date();
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
    return date > sevenMonthsAgo;
  };
  
  const extractMajorVersions = (version: string): number[] => {
    // Split by "||" to handle multiple version ranges
    const versionRanges = version.split('||').map(v => v.trim());
    
    const majorVersions = new Set<number>();
    
    versionRanges.forEach(range => {
      // Remove caret or tilde if present (^2.0.13 -> 2.0.13)
      const cleanVersion = range.replace(/[\^~]/, '');
      
      // Handle beta versions like "3.0.0-beta.130" or released v3 like "3.0.0"
      const betaMatch = cleanVersion.match(/^(\d+)\.0\.0(?:-beta|$)/);
      if (betaMatch) {
        majorVersions.add(parseInt(betaMatch[1]));
        return;
      }
      
      // Handle regular versions like "2.0.13"
      const match = cleanVersion.match(/^(\d+)\./);
      if (match) {
        majorVersions.add(parseInt(match[1]));
      }
    });
    
    return Array.from(majorVersions);
  };

const getPayloadVersion = (packageJson: PackageJson): string | null => {
  return (
    packageJson.peerDependencies?.payload ||
    packageJson.dependencies?.payload ||
    packageJson.devDependencies?.payload ||
    null
  );
};

const PluginDirectory: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('stars');
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPluginDetails = async (repo: GitHubRepo): Promise<Plugin> => {
      try {
        // Fetch package.json from the default branch
        const packageJsonUrl = `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${repo.default_branch}/package.json`;
        const response = await fetch(packageJsonUrl);
        
        let payloadVersion: string | null = null;
        let payloadVersionMajor: number[] | null = null;
        
        if (response.ok) {
          const packageJson: PackageJson = await response.json();
          payloadVersion = getPayloadVersion(packageJson);
          if (payloadVersion) {
            payloadVersionMajor = extractMajorVersions(payloadVersion);
          }
        }
    // If version is not detected and plugin is recent, assume it's version 3
    if (!payloadVersionMajor && isWithinLastSevenMonths(repo.updated_at)) {
        payloadVersionMajor = [3];
        payloadVersion = "^3.0.0";
      }
        return {
          id: repo.id,
          name: repo.name,
          description: repo.description || 'No description available',
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          lastUpdate: repo.updated_at,
          owner: repo.owner.login,
          url: repo.html_url,
          topics: repo.topics || [],
          isOfficial: repo.owner.login.toLowerCase() === 'payloadcms',
          payloadVersion,
          payloadVersionMajor
        };
      } catch (err) {
        console.error(`Error fetching package.json for ${repo.name}:`, err);
        return {
          id: repo.id,
          name: repo.name,
          description: repo.description || 'No description available',
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          lastUpdate: repo.updated_at,
          owner: repo.owner.login,
          url: repo.html_url,
          topics: repo.topics || [],
          isOfficial: repo.owner.login.toLowerCase() === 'payloadcms',
          payloadVersion: null,
          payloadVersionMajor: null
        };
      }
    };

    const fetchPlugins = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(
          'https://api.github.com/search/repositories?q=topic:payload-plugin+fork:true&sort=stars&order=desc&per_page=100',
          {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch plugins: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Fetch package.json for each repository
        const pluginsWithVersion = await Promise.all(
          data.items.map((repo: GitHubRepo) => fetchPluginDetails(repo))
        );

        setPlugins(pluginsWithVersion);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        console.error('Error fetching plugins:', errorMessage);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchPlugins();
  }, []);

  const filteredAndSortedPlugins = plugins
  .filter(plugin =>
    // Text search filter
    (plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    plugin.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    plugin.topics.some(topic => topic.toLowerCase().includes(searchTerm.toLowerCase())) ||
    plugin.owner.toLowerCase().includes(searchTerm.toLowerCase())) &&
    // Version filter
    (versionFilter === 'all' || 
     (plugin.payloadVersionMajor !== null && 
      plugin.payloadVersionMajor.includes(parseInt(versionFilter))))
  ).sort((a, b) => {
      switch (sortBy) {
        case 'stars':
          return b.stars - a.stars;
        case 'forks':
          return b.forks - a.forks;
        case 'recent':
          return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
        default:
          return 0;
      }
    });

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Payload CMS Plugin Directory</h1>
        <p className="text-gray-600 mb-6">
          Discover community-made plugins for Payload CMS. All plugins listed here use the
          `payload-plugin` GitHub topic tag.
        </p>
        
        <div className="flex flex-col gap-4 mb-6 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search plugins by name, description, topics, or author..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <Select 
            value={versionFilter} 
            onValueChange={(value: VersionFilter) => setVersionFilter(value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Payload Version" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Versions</SelectItem>
              <SelectItem value="1">Payload v1</SelectItem>
              <SelectItem value="2">Payload v2</SelectItem>
              <SelectItem value="3">Payload v3</SelectItem>
            </SelectContent>
          </Select>
          
          <Select 
            value={sortBy} 
            onValueChange={(value: SortOption) => setSortBy(value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stars">Most Stars</SelectItem>
              <SelectItem value="forks">Most Forks</SelectItem>
              <SelectItem value="recent">Recently Updated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}. Please try again later.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="text-center py-12">Loading plugins...</div>
      ) : filteredAndSortedPlugins.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          No plugins found matching your search criteria.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredAndSortedPlugins.map((plugin) => (
            <Card key={plugin.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2 flex-wrap">
                  <a
                    href={plugin.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-blue-600"
                  >
                    {plugin.name}
                  </a>
                  {plugin.isOfficial && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                      Official
                    </Badge>
                  )}
                </CardTitle>
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <span>by {plugin.owner}</span>
                  {plugin.payloadVersion && (
                    <Badge variant="outline" className="gap-1">
                      <Package className="h-3 w-3" />
                      Payload {plugin.payloadVersion}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-4">{plugin.description}</p>
                
                <div className="flex gap-4 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <Star className="h-4 w-4" />
                    {plugin.stars}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitFork className="h-4 w-4" />
                    {plugin.forks}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {formatDate(plugin.lastUpdate)}
                  </span>
                </div>
                
                <div className="mt-4 flex flex-wrap gap-2">
                  {plugin.topics
                    .filter(topic => topic !== 'payload-plugin')
                    .map((topic) => (
                    <span
                      key={`${plugin.id}-${topic}`}
                      className="px-2 py-1 bg-gray-100 rounded-full text-sm text-gray-600"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default PluginDirectory;
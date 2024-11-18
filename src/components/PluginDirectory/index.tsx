"use client";

import React, { useState } from "react";
import { 
  Search, GitFork, Star, Clock 
} from "lucide-react";
import { 
  Card, CardContent, CardHeader, CardTitle 
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Select, SelectContent, SelectItem, 
  SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  Plugin, SortOption, VersionFilter 
} from "../../types";
import { PayloadIcon } from "../PayloadIcon";

interface PluginDirectoryProps {
  plugins: Plugin[];
}

export const PluginDirectory: React.FC<PluginDirectoryProps> = ({ plugins }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("stars");
  const [versionFilter, setVersionFilter] = useState<VersionFilter>("all");

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const filteredAndSortedPlugins = plugins
    .filter(
      (plugin) =>
        (plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        plugin.topics.some((topic) =>
          topic.toLowerCase().includes(searchTerm.toLowerCase())
        ) ||
        plugin.owner.toLowerCase().includes(searchTerm.toLowerCase())) &&
        (versionFilter === "all" ||
          (plugin.payloadVersionMajor !== null &&
            plugin.payloadVersionMajor.includes(parseInt(versionFilter))))
    )
    .sort((a, b) => {
      switch (sortBy) {
        case "stars": return b.stars - a.stars;
        case "forks": return b.forks - a.forks;
        case "recent": 
          return new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime();
        default: return 0;
      }
    });

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">
          Payload CMS Plugin Directory
        </h1>
        <p className="text-gray-600 mb-6">
          Discover community-made plugins for Payload CMS.
        </p>

        <div className="flex flex-col gap-4 mb-6 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search plugins..."
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

      {filteredAndSortedPlugins.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          No plugins found matching your search criteria.
        </div>
      ) : (
        <div>
           <p className="text-gray-600 mb-4" >{filteredAndSortedPlugins.length} plugins found</p>
       
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
         
          {filteredAndSortedPlugins.map((plugin) => (
            <Card key={plugin.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="text-xl flex items-center  gap-2 flex-wrap">
                  <a
                    href={plugin.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-blue-600 first-letter:capitalize"
                  >
                    {plugin.name}
                  </a>
                  {plugin.isOfficial && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      Official
                    </Badge>
                  )}
                  {plugin.collection && (
                    <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                      Collection: {plugin.collection}
                    </Badge>
                  )}
                </CardTitle>
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <span>by {plugin.owner}</span>
                  {plugin.payloadVersionMajor && (
                    <Badge variant="outline" className="gap-1" title={plugin.payloadVersion!} >
                      <PayloadIcon className="h-3 w-3 fill-black" />
                      Payload version {plugin.payloadVersionMajor.map((v) => v).join(" & ")}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-4">{plugin.description}</p>

                <div className="flex gap-4 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <Star className="h-4 w-4" /> {plugin.stars}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitFork className="h-4 w-4" /> {plugin.forks}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" /> {formatDate(plugin.lastUpdate)}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {plugin.topics
                    .filter((topic) => topic !== "payload-plugin")
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
        </div>
      )}
    </div>
  );
};
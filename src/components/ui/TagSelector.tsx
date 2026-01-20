'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Loader2, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Tag } from '@/app/actions/tags';

interface TagSelectorProps {
    availableTags: Tag[];
    selectedTags: string[]; // array of tag names
    onTagsChange: (tags: string[]) => void;
    isLoading?: boolean;
    maxVisibleTags?: number; // Maximum tags to show before "+X more"
    compact?: boolean; // Compact mode for tight spaces
}

export function TagSelector({
    availableTags,
    selectedTags,
    onTagsChange,
    isLoading,
    maxVisibleTags = 3,
    compact = false
}: TagSelectorProps) {
    const [open, setOpen] = React.useState(false);

    const toggleTag = (tagName: string) => {
        const newTags = selectedTags.includes(tagName)
            ? selectedTags.filter(t => t !== tagName)
            : [...selectedTags, tagName];
        onTagsChange(newTags);
    };

    const clearAll = () => {
        onTagsChange([]);
    };

    const getTagColor = (tagName: string) => {
        const tag = availableTags.find(t => t.name === tagName);
        return tag ? (tag.color.startsWith('#') ? tag.color : `#${tag.color}`) : '#888';
    };

    const visibleTags = selectedTags.slice(0, maxVisibleTags);
    const hiddenCount = selectedTags.length - maxVisibleTags;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        "justify-between min-w-0",
                        compact ? "h-8 text-xs px-2" : "w-full"
                    )}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <span className="flex items-center">
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                            Laden...
                        </span>
                    ) : selectedTags.length > 0 ? (
                        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                            {visibleTags.map(tagName => (
                                <Badge
                                    key={tagName}
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 shrink-0"
                                    style={{ borderLeft: `3px solid ${getTagColor(tagName)}` }}
                                >
                                    {tagName}
                                </Badge>
                            ))}
                            {hiddenCount > 0 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                    +{hiddenCount}
                                </Badge>
                            )}
                        </div>
                    ) : (
                        <span className="text-muted-foreground">
                            {compact ? "Tags..." : "Tags auswählen..."}
                        </span>
                    )}
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
                <Command>
                    <div className="flex items-center border-b px-3">
                        <Search className="h-4 w-4 shrink-0 opacity-50" />
                        <CommandInput placeholder="Tags suchen..." className="border-0" />
                    </div>
                    <CommandList className="max-h-[200px]">
                        <CommandEmpty>Keine Tags gefunden.</CommandEmpty>
                        <CommandGroup>
                            {availableTags.map((tag) => (
                                <CommandItem
                                    key={tag.id}
                                    value={tag.name}
                                    onSelect={() => toggleTag(tag.name)}
                                    className="cursor-pointer"
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            selectedTags.includes(tag.name) ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <div
                                        className="w-3 h-3 rounded-full mr-2 shrink-0"
                                        style={{ backgroundColor: tag.color.startsWith('#') ? tag.color : `#${tag.color}` }}
                                    />
                                    <span className="truncate">{tag.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                    {selectedTags.length > 0 && (
                        <div className="border-t p-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={(e) => {
                                    e.preventDefault();
                                    clearAll();
                                }}
                            >
                                <X className="h-3 w-3 mr-1" />
                                Alle entfernen ({selectedTags.length})
                            </Button>
                        </div>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
}

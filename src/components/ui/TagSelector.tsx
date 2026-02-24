'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag } from '@/lib/actions/tags';

interface TagSelectorProps {
    availableTags: Tag[];
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
    isLoading?: boolean;
}

function resolveColor(tag: Tag): string {
    const c = tag.color ?? '';
    // Normalize to full 6-digit hex so CSS interpolation is always valid
    if (c.startsWith('#') && (c.length === 7 || c.length === 4)) return c;
    if (c.startsWith('#')) return c; // trust longer values (#rrggbbaa etc.)
    if (/^[0-9a-fA-F]{3}$/.test(c)) return `#${c}${c}`; // expand 3-char → 6
    if (/^[0-9a-fA-F]{6}$/.test(c)) return `#${c}`;
    return '#6366f1'; // fallback
}

function fallbackColor(): string {
    return '#94a3b8'; // slate-400, always 6-digit
}

export function TagSelector({ availableTags, selectedTags, onTagsChange, isLoading }: TagSelectorProps) {
    const [open, setOpen] = React.useState(false);

    const getColor = (tagName: string): string => {
        const tag = availableTags.find(t => t.name === tagName);
        return tag ? resolveColor(tag) : fallbackColor();
    };

    const remove = (tagName: string) => {
        onTagsChange(selectedTags.filter(t => t !== tagName));
    };

    const add = (tagName: string) => {
        if (!selectedTags.includes(tagName)) {
            onTagsChange([...selectedTags, tagName]);
        }
        setOpen(false);
    };

    const unselected = availableTags.filter(t => !selectedTags.includes(t.name));

    return (
        <div className="flex flex-wrap gap-1 items-center min-h-[20px]">
            {selectedTags.map(tagName => {
                const color = getColor(tagName);
                return (
                    <span
                        key={tagName}
                        className="group inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium select-none"
                        style={{
                            backgroundColor: `${color}1a`,
                            color: color,
                            border: `1px solid ${color}55`,
                        }}
                    >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        {tagName}
                        {!isLoading && (
                            <button
                                onClick={() => remove(tagName)}
                                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity ml-0.5"
                                title={`${tagName} entfernen`}
                            >
                                <X className="h-2.5 w-2.5" />
                            </button>
                        )}
                    </span>
                );
            })}

            {isLoading && (
                <span className="text-[10px] text-muted-foreground animate-pulse">…</span>
            )}

            {!isLoading && (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors shrink-0"
                            title="Tag hinzufügen"
                        >
                            <Plus className="h-2.5 w-2.5" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto max-w-[240px] p-2.5" align="start">
                        {unselected.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Alle Tags vergeben</p>
                        ) : (
                            <>
                                <p className="text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">Tag hinzufügen</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {unselected.map(tag => {
                                        const color = resolveColor(tag);
                                        return (
                                            <button
                                                key={tag.id}
                                                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-80 cursor-pointer"
                                                style={{
                                                    backgroundColor: `${color}1a`,
                                                    color: color,
                                                    border: `1px solid ${color}55`,
                                                }}
                                                onClick={() => add(tag.name)}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                                {tag.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}

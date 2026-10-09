/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { isNonNullish } from "@utils/guards";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, Forms, Menu, RelationshipStore, UserStore } from "@webpack/common";

const UserUtils = findByPropsLazy("getGlobalName");

function getDMName(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return channelId;
    return channel.name ||
        channel.recipients
            .map((id: string) => UserStore.getUser(id))
            .filter(isNonNullish)
            .map((u: any) => RelationshipStore.getNickname(u.id) || UserUtils.getName(u))
            .join(", ") ||
        channelId;
}

function ManageHiddenDMs() {
    settings.use(["hiddenDMs"]);
    const hiddenIds: string[] = settings.store.hiddenDMs ?? [];

    if (hiddenIds.length === 0) {
        return <Forms.FormText>No hidden  DMs.</Forms.FormText>;
    }

    return (
        <div>
            <Forms.FormTitle>Hidden  DMs</Forms.FormTitle>
            {hiddenIds.map(id => (
                <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <Forms.FormText style={{ flexGrow: 1 }}>{getDMName(id)}</Forms.FormText>
                    <Button
                        size={Button.Sizes.SMALL}
                        onClick={() => {
                            const ids = getHiddenSet();
                            ids.delete(id);
                            setHiddenSet(ids);
                        }}
                    >
                        Unhide
                    </Button>
                </div>
            ))}
        </div>
    );
}

const settings = definePluginSettings({
    hiddenDMs: {
        type: OptionType.CUSTOM,
        description: "Hidden DM channel IDs",
        default: [] as string[],
    },
    manageHidden: {
        type: OptionType.COMPONENT,
        description: "Manage hidden DMs",
        component: ManageHiddenDMs,
    }
});

let forceUpdateDmList: (() => void) | undefined;

function getHiddenSet(): Set<string> {
    return new Set(settings.store.hiddenDMs ?? []);
}

function setHiddenSet(ids: Set<string>) {
    settings.store.hiddenDMs = [...ids];
    forceUpdateDmList?.();
}

const DMContext: NavContextMenuPatchCallback = (children, { channel }) => {
    const hidden = getHiddenSet().has(channel.id);
    const container = findGroupChildrenByChildId("mute-channel", children);

    const item = (
        <Menu.MenuItem
            id="vc-hide-dm"
            label={hidden ? "Show  DM" : "Hide  DM"}
            action={() => {
                const ids = getHiddenSet();
                if (hidden) ids.delete(channel.id);
                else ids.add(channel.id);
                setHiddenSet(ids);
            }}
        />
    );

    if (container) container.unshift(item);
    else children.push(item);
};

export default definePlugin({
    name: "HideDMs",
    description: "Right-click a DM to hide it from the list",
    authors: [{ name: "madness", id: 469992879977267201n }],
    settings,

    contextMenus: {
        "user-context": DMContext,
    },

    patches: [
        {
            // Filter hidden  DMs from the main DM list
            find: '"dm-quick-launcher"===',
            replacement: {
                match: /(?<=channels:\i,)privateChannelIds:(\i)(?=,listRef:)/,
                replace: "privateChannelIds:$1.filter(c=>$self.shouldShow(c))"
            }
        },
        {
            // Make the DM list component reactive to our hidden set changes
            find: ".FRIENDS},\"friends\"",
            replacement: {
                match: /let\{showLibrary:\i,/,
                replace: "$self.useHideDMs();$&"
            }
        },
        {
            // Fix Alt+Up/Down navigation skipping hidden  DMs
            find: ".APPLICATION_STORE&&",
            replacement: {
                match: /(?<=\i=__OVERLAY__\?\i:\[\.\.\.\i\(\),\.\.\.)\i/,
                replace: "$&.filter(c=>$self.shouldShow(c))"
            }
        },
        {
            // Fix Alt+Shift+Up/Down navigation
            find: "=()=>!1,ensureChatIsVisible:",
            replacement: {
                match: /(?<=\i===\i\.ME\?)\i\.\i\.getPrivateChannelIds\(\)/,
                replace: "$&.filter(c=>$self.shouldShow(c))"
            }
        },
        {
            // Filter hidden DMs from the unread DMs sidebar
            find: '"guild-list-unread-dms"',
            replacement: {
                match: /\(0,(\i\.\i)\)\(\[(\i\.\i)\],\(\)=>\2\.getUnreadPrivateChannelIds\(\)\)/,
                replace: "(0,$1)([$2],()=>$2.getUnreadPrivateChannelIds().filter(c=>$self.shouldShow(c)))"
            }
        },
        {
            find: ".SUPPRESS_NOTIFICATIONS))return!1",
            replacement: {
                match: /function (\i)\((\i),(\i)\)\{/,
                replace: "function $1($2,$3){if($self.shouldSuppressPopup($2,$3))return false;"
            }
        },
    ],

    shouldShow(channelId: string): boolean {
        const channel = ChannelStore.getChannel(channelId);
        if (!channel || channel.type !== 1) return true;

        return !getHiddenSet().has(channelId);
    },

    useHideDMs() {
        forceUpdateDmList = useForceUpdater();
        settings.use(["hiddenDMs"]);
    },


    shouldSuppressPopup(message: any, channelId: string): boolean {
        const hiddenIds = getHiddenSet();

        // Check both possible sources of the channel ID.
        const id = channelId || message?.channel_id;

        return Boolean(
            id && (
                hiddenIds.has(id) ||
                hiddenIds.has(message?.channel_id)
            )
        );
    },

    // flux: {
    //     MESSAGE_CREATE({ message }: { message: { channel_id: string; }; }) {
    //         const channel = ChannelStore.getChannel(message.channel_id);
    //         if (channel?.type !== 3) return;

    //         const ids = getHiddenSet();
    //         if (ids.has(message.channel_id)) {
    //             ids.delete(message.channel_id);
    //             setHiddenSet(ids);
    //         }
    //     }
    // }
});

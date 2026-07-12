import { Metadata } from "../data/metadata";
import { Nation } from "../data/wiki-data";

type JoinedRow = {
    name: string;
    alt_name: string;
    wk_name: string;
    nation: Nation;
    cls: string;
    ab_br: string;
    rb_br: string;
    sb_br: string;
    ab_repair: string;
    rb_repair: string;
    sb_repair: string;
    rb_battles: string;
    rb_win_rate: string;
    rb_ground_frags_per_battle: string;
    rb_ground_frags_per_death: string;
    rb_rp_rate: string;
    rb_sl_rate: string;
    is_premium: string;
};

type SourceInfo = {
    generatedAt: string;
    upstreamMetadataUrl: string;
    upstreamWebRepo: string;
    upstreamDataRepo: string;
    forkRepo: string;
    latestJoined: Metadata;
    trendDates?: { d1: string; d7: string; d30: string };
};

type VehicleImage = {
    imageUrl: string;
    thumbnailUrl?: string;
    previewUrl?: string;
    fallbackImageUrl: string;
    sourcePage: string;
    sourceFileTitle: string;
    sourceUrl: string;
    sourceKind: "vehicle-page-image" | "wiki-slot-thumbnail" | "placeholder";
    fallbackSource: "wiki-slot-thumbnail";
    imageWidth: number;
    imageHeight: number;
    attribution: string;
    matchedBy: string;
    confidence: "high" | "medium" | "low";
    score: number;
    matchNotes: string[];
    focalX?: number;
    focalY?: number;
    zoom?: number;
};

type TrendMetrics = {
    battles: number | null;
    winRate: number | null;
    fragsPerBattle: number | null;
    fragsPerDeath: number | null;
    br: number | null;
};

type VehicleTrend = {
    name: string;
    nation: string;
    latest: TrendMetrics;
    history: { d1: TrendMetrics | null; d7: TrendMetrics | null; d30: TrendMetrics | null };
    delta7: TrendMetrics;
    delta30: TrendMetrics;
    isNew: boolean;
};

type TrendManifest = {
    generatedAt: string;
    latestDate: string;
    dates: { d1: string; d7: string; d30: string };
    vehicles: { [name: string]: VehicleTrend };
    changes: Array<VehicleTrend & { id: string }>;
};

type VehicleImageManifest = {
    generatedAt: string;
    source: {
        name: string;
        groundPage: string;
        cdn: string;
        note: string;
    };
    images: { [name: string]: VehicleImage };
    misses: Array<{ id: string; name: string; reason: string }>;
    stats: {
        totalGroundVehicles: number;
        matched: number;
        vehiclePageImages: number;
        slotThumbnails: number;
        placeholders: number;
    };
};

type Filters = {
    nation: string;
    brMin: number;
    brMax: number;
    premium: string;
    minBattles: number;
    query: string;
    favoritesOnly: boolean;
};

type SavedPreset = {
    name: string;
    filters: Filters;
    sort: SortMode;
    view: ViewMode;
};

const STORAGE_RECENT = "wt-ground-rb-recent-searches";
const STORAGE_FAVORITES = "wt-ground-rb-favorites";
const STORAGE_COMPARE = "wt-ground-rb-compare";
const STORAGE_TABLE_SORT = "wt-ground-rb-table-sort";
const STORAGE_PRESETS = "wt-ground-rb-saved-presets";
const CARD_PAGE_SIZE = 50;
const LOW_SAMPLE_BATTLES = 400;

type SortMode = "win" | "played" | "gkd" | "gkb" | "brAsc" | "brDesc" | "name";
type ViewMode = "card" | "table";
type SortDirection = "asc" | "desc";
type TableSortKey = "vehicle" | "nation" | "br" | "rank" | "win" | "battles" | "gkb" | "gkd" | "premium";
type TableSort = {
    key: TableSortKey;
    direction: SortDirection;
};
type RankedRow = {
    row: JoinedRow;
    resultRank: number;
};

export class GroundRbPanel {
    private root: HTMLElement;
    private rows: JoinedRow[] = [];
    private metadata: Metadata[];
    private sourceInfo: SourceInfo | null = null;
    private imageManifest: VehicleImageManifest | null = null;
    private trendManifest: TrendManifest | null = null;
    private selected: JoinedRow | null = null;
    private compareNames: string[] = [];
    private favorites: string[] = [];
    private recentSearches: string[] = [];
    private currentSort: SortMode = "gkd";
    private currentView: ViewMode = "card";
    private tableSort: TableSort | null = null;
    private savedPresets: SavedPreset[] = [];
    private visibleCards = CARD_PAGE_SIZE;
    private drawerReturnFocus: HTMLElement | null = null;

    constructor(metadata: Metadata[]) {
        this.metadata = metadata;
        this.compareNames = this.readList(STORAGE_COMPARE);
        this.favorites = this.readList(STORAGE_FAVORITES);
        this.recentSearches = this.readList(STORAGE_RECENT);
        this.tableSort = this.readTableSort();
        this.savedPresets = this.readPresets();
    }

    render(parent: HTMLElement): void {
        this.root = document.createElement("section");
        this.root.id = "ground-rb-home";
        this.root.className = "ground-rb-home";
        this.root.setAttribute("aria-label", "Ground RB quick start");
        this.root.innerHTML = this.shellHtml("Loading local Ground RB data...");
        parent.appendChild(this.root);
        this.load();
    }

    private async load(): Promise<void> {
        try {
            const [rows, sourceInfo, imageManifest, trendManifest] = await Promise.all([
                this.loadRows(),
                fetch("data/source-info.json").then(response => this.requireOk(response, "data/source-info.json")).then(response => response.json()),
                this.loadImageManifest(),
                this.loadTrendManifest()
            ]);
            this.sourceInfo = sourceInfo;
            this.imageManifest = imageManifest;
            this.trendManifest = trendManifest;
            this.rows = rows
                .filter(row => row.cls === "Ground_vehicles")
                .filter(row => this.toNumber(row.rb_battles) > 0);

            this.applyUrlSelection();
            this.renderLoaded();
        } catch (error) {
            this.root.innerHTML = this.shellHtml(
                `Ground RB data could not load. ${error instanceof Error ? error.message : "Unknown error."}`
            );
            this.root.querySelector(".data-status").classList.add("is-error");
        }
    }

    private shellHtml(message: string): string {
        const latest = this.metadata
            .filter(entry => entry.type === "joined")
            .slice(-1)[0];
        return `
            <div class="data-status" role="status" aria-live="polite">
                <strong>Data status</strong>
                <span>${this.escape(message)}</span>
                <small>Metadata: ${latest ? this.escape(latest.date) : "not loaded"} from /data/metadata.json</small>
            </div>
        `;
    }

    private renderLoaded(): void {
        const latest = this.sourceInfo ? this.sourceInfo.latestJoined : null;
        this.root.innerHTML = `
            <details class="ground-rb-filters" open>
                <summary><span>Filters and presets</span><small>Nation, BR, premium status, sample floor, and search</small></summary>
                <div class="ground-rb-intro">
                    <div class="preset-bar" aria-label="Quick analysis presets">
                        ${this.button("preset-win", "Top Ground RB win rate")}
                        ${this.button("preset-played", "Most-played Ground RB vehicles")}
                        ${this.button("preset-frags", "High ground frags per battle")}
                        ${this.button("preset-premium", "Premium Ground RB vehicles")}
                        ${this.button("preset-sample", "Low sample size hidden")}
                    </div>
                </div>
                <div class="filter-grid">
                    ${this.select("ground-nation", "Nation", this.nationOptions())}
                    ${this.numberInput("ground-br-min", "BR min", "0", "13.7", "0.3", "0")}
                    ${this.numberInput("ground-br-max", "BR max", "1", "13.7", "0.3", "13.7")}
                    ${this.select("ground-premium", "Premium", [
                        ["all", "All"],
                        ["premium", "Premium"],
                        ["regular", "Non-premium"]
                    ])}
                    ${this.select("ground-favorites", "Saved", [
                        ["all", "All vehicles"],
                        ["favorites", "Favourites only"]
                    ])}
                    ${this.numberInput("ground-min-battles", "Min battles", "0", "100000", "100", "400")}
                    <label class="search-label">Vehicle search
                        <input id="ground-search" type="search" placeholder="XM1, Leopard 2, T-80..." autocomplete="off" aria-label="Search vehicles">
                    </label>
                </div>
                <div class="search-memory">
                    <div><strong>Recent searches</strong><span id="recent-searches"></span></div>
                    <div><strong>Favourite vehicles</strong><span id="favorite-vehicles"></span></div>
                </div>
                <div class="saved-preset-bar" aria-label="Saved filter presets">
                    <label>Saved preset
                        <select id="saved-preset-select" aria-label="Saved preset">${this.savedPresetOptions()}</select>
                    </label>
                    <button type="button" id="save-current-preset">Save</button>
                    <button type="button" id="delete-saved-preset">Delete</button>
                    <button type="button" id="export-saved-presets">Export</button>
                    <button type="button" id="import-saved-presets">Import</button>
                    <input id="preset-import-file" type="file" accept="application/json" hidden>
                </div>
            </details>
            <div class="results-toolbar" aria-label="Vehicle result display controls">
                <div class="results-title">
                    <span class="eyebrow">Filtered results</span>
                    <strong id="result-count"></strong>
                    <small>Data as of ${latest ? this.escape(latest.date) : "N/A"}</small>
                </div>
                <div class="results-controls">
                    <div class="results-actions" aria-label="Workspace tools">
                        <button type="button" id="open-changes">Changes</button>
                        <button type="button" id="open-lineup">Lineup</button>
                        <button type="button" id="open-compare">Compare <span id="compare-count">${this.compareNames.length}</span></button>
                    </div>
                    <label>Sort
                        ${this.selectBare("ground-sort", [
                            ["gkd", "Frags / death descending"],
                            ["win", "Win rate descending"],
                            ["played", "Battles descending"],
                            ["gkb", "Frags / battle descending"],
                            ["brAsc", "BR ascending"],
                            ["brDesc", "BR descending"],
                            ["name", "Name A-Z"]
                        ])}
                    </label>
                    <div class="view-toggle" role="group" aria-label="View mode">
                        <button type="button" id="view-card" aria-pressed="true">Cards</button>
                        <button type="button" id="view-table" aria-pressed="false">Table</button>
                    </div>
                </div>
            </div>
            <div id="ground-card-view" class="ground-card-view"></div>
            <div class="card-more-wrap"><button type="button" id="show-more-cards">Show more</button></div>
            <div id="ground-table-view" class="ground-rb-results-wrap" hidden>
                <table class="ground-rb-results" aria-label="Ground RB vehicle results">
                    <thead>
                        <tr>
                            ${this.tableHeader("vehicle", "Vehicle")}
                            ${this.tableHeader("nation", "Nation")}
                            ${this.tableHeader("br", "BR")}
                            ${this.tableHeader("rank", "Rank")}
                            ${this.tableHeader("win", "Win")}
                            ${this.tableHeader("battles", "Battles")}
                            ${this.tableHeader("gkb", "Frags / battle")}
                            ${this.tableHeader("gkd", "Frags / death")}
                            ${this.tableHeader("premium", "Premium")}
                            <th aria-label="Actions"></th>
                        </tr>
                    </thead>
                    <tbody id="ground-results"></tbody>
                </table>
                <p class="table-legend">Bold Battles values indicate fewer than ${LOW_SAMPLE_BATTLES} battles; interpret cautiously.</p>
            </div>
            <div id="workspace-drawer" class="workspace-drawer" hidden>
                <div class="workspace-drawer-backdrop" data-drawer-close></div>
                <aside class="workspace-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="workspace-drawer-title">
                    <header>
                        <div><span class="eyebrow">Vehicle workspace</span><h2 id="workspace-drawer-title">Details</h2></div>
                        <button type="button" id="workspace-drawer-close" aria-label="Close vehicle workspace">Close</button>
                    </header>
                    <div id="workspace-drawer-content" class="workspace-drawer-content" aria-live="polite"></div>
                </aside>
            </div>
            <aside class="source-card">
                <h3>Data, Source, and License</h3>
                <p>Fork source: <a href="${this.sourceInfo.forkRepo}">zeoce/wt-data-project.web</a>. Upstream web: <a href="${this.sourceInfo.upstreamWebRepo}">ControlNet/wt-data-project.web</a>. Upstream data: <a href="${this.sourceInfo.upstreamDataRepo}">ControlNet/wt-data-project.data</a>.</p>
                <p>This AGPL project keeps source availability and upstream attribution visible. Thunderskill-derived data is sample-based, and joined vehicle matching may contain errors. Treat low-sample values as directional, not definitive.</p>
                <p>${this.imageSourceCopy()} Ground frags and deaths on cards are estimates derived from battles and per-battle/per-death rates.</p>
                <p>Prepared: ${this.formatDate(this.sourceInfo.generatedAt)}. Latest data date: ${latest ? this.escape(latest.date) : "N/A"}.</p>
            </aside>
            <div id="vehicle-image-modal" class="vehicle-image-modal" hidden>
                <div class="vehicle-image-backdrop" data-modal-close></div>
                <section class="vehicle-image-dialog" role="dialog" aria-modal="true" aria-labelledby="vehicle-image-title">
                    <div class="vehicle-image-dialog-head">
                        <div>
                            <h3 id="vehicle-image-title"></h3>
                            <a id="vehicle-image-source" href="#" target="_blank" rel="noreferrer"></a>
                        </div>
                        <button type="button" id="vehicle-image-close" aria-label="Close image preview">Close</button>
                    </div>
                    <div class="vehicle-image-preview-frame">
                        <img id="vehicle-image-preview" alt="" onerror="this.closest('.vehicle-image-dialog').classList.add('image-failed'); this.removeAttribute('src');">
                    </div>
                </section>
            </div>
            <div id="app-toast" class="app-toast" role="status" aria-live="polite" hidden></div>
        `;
        this.applyUrlState();
        this.bindEvents();
        this.renderMemory();
        this.updateResults();
        if (this.selected) this.renderDetail(this.selected);
    }

    private bindEvents(): void {
        ["ground-nation", "ground-br-min", "ground-br-max", "ground-premium", "ground-favorites", "ground-min-battles", "ground-search"]
            .forEach(id => this.byId(id).addEventListener("input", () => this.updateResults()));
        this.byId("ground-sort").addEventListener("change", () => {
            this.currentSort = (this.byId("ground-sort") as HTMLSelectElement).value as SortMode;
            this.updateResults();
        });
        this.byId("view-card").addEventListener("click", () => this.setView("card"));
        this.byId("view-table").addEventListener("click", () => this.setView("table"));
        this.byId("show-more-cards").addEventListener("click", () => {
            this.visibleCards += CARD_PAGE_SIZE;
            this.updateResults();
        });
        this.byId("vehicle-image-close").addEventListener("click", () => this.closeImagePreview());
        this.root.querySelector("[data-modal-close]").addEventListener("click", () => this.closeImagePreview());
        this.byId("workspace-drawer-close").addEventListener("click", () => this.closeDrawer());
        this.root.querySelector("[data-drawer-close]").addEventListener("click", () => this.closeDrawer());
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                this.closeImagePreview();
                this.closeDrawer();
            }
        });
        this.bindTableHeaderSort();

        this.byId("preset-win").addEventListener("click", () => this.applyPreset("win"));
        this.byId("preset-played").addEventListener("click", () => this.applyPreset("played"));
        this.byId("preset-frags").addEventListener("click", () => this.applyPreset("frags"));
        this.byId("preset-premium").addEventListener("click", () => this.applyPreset("premium"));
        this.byId("preset-sample").addEventListener("click", () => this.applyPreset("sample"));
        this.byId("open-changes").addEventListener("click", event => this.openChangeFeed(event.currentTarget as HTMLElement));
        this.byId("open-lineup").addEventListener("click", event => this.openLineupBuilder(event.currentTarget as HTMLElement));
        this.byId("open-compare").addEventListener("click", event => this.openCompareDrawer(event.currentTarget as HTMLElement));
        this.byId("save-current-preset").addEventListener("click", () => this.saveCurrentPreset());
        this.byId("delete-saved-preset").addEventListener("click", () => this.deleteSavedPreset());
        this.byId("export-saved-presets").addEventListener("click", () => this.exportSavedPresets());
        this.byId("import-saved-presets").addEventListener("click", () => (this.byId("preset-import-file") as HTMLInputElement).click());
        this.byId("preset-import-file").addEventListener("change", event => this.importSavedPresets(event));
        this.byId("saved-preset-select").addEventListener("change", () => this.applySavedPreset());
    }

    private bindTableHeaderSort(): void {
        Array.prototype.forEach.call(this.root.querySelectorAll("[data-table-sort]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => {
                const key = button.getAttribute("data-table-sort") as TableSortKey;
                this.setTableSort(key);
            });
        });
    }

    private setTableSort(key: TableSortKey): void {
        if (this.tableSort && this.tableSort.key === key) {
            this.tableSort = {
                key,
                direction: this.tableSort.direction === "asc" ? "desc" : "asc"
            };
        } else {
            this.tableSort = {
                key,
                direction: this.defaultTableSortDirection(key)
            };
        }
        localStorage.setItem(STORAGE_TABLE_SORT, JSON.stringify(this.tableSort));
        this.updateResults();
    }

    private setView(view: ViewMode): void {
        this.currentView = view;
        (this.byId("ground-card-view") as HTMLElement).hidden = view !== "card";
        (this.byId("ground-table-view") as HTMLElement).hidden = view !== "table";
        (this.byId("show-more-cards") as HTMLButtonElement).hidden = view !== "card";
        this.byId("view-card").setAttribute("aria-pressed", String(view === "card"));
        this.byId("view-table").setAttribute("aria-pressed", String(view === "table"));
        this.updateResults();
    }

    private bindCardButtons(container: HTMLElement): void {
        Array.prototype.forEach.call(container.querySelectorAll("[data-select]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-select"), button));
        });
        Array.prototype.forEach.call(container.querySelectorAll("[data-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => {
                this.toggleCompare(button.getAttribute("data-compare"));
                this.openCompareDrawer(button);
            });
        });
        Array.prototype.forEach.call(container.querySelectorAll("[data-fav-toggle]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => {
                const name = button.getAttribute("data-fav-toggle");
                if (!name) return;
                this.toggleName(this.favorites, name, STORAGE_FAVORITES, 99);
                this.renderMemory();
                this.updateResults();
            });
        });
        Array.prototype.forEach.call(container.querySelectorAll("[data-show-plot]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.openTrendDrawer(button.getAttribute("data-show-plot"), button));
        });
        Array.prototype.forEach.call(container.querySelectorAll("[data-image-preview]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.openImagePreview(button.getAttribute("data-image-preview")));
        });
    }

    private compareRows(a: JoinedRow, b: JoinedRow): number {
        switch (this.currentSort) {
            case "played":
                return this.toNumber(b.rb_battles) - this.toNumber(a.rb_battles);
            case "gkd":
                return this.toNumber(b.rb_ground_frags_per_death) - this.toNumber(a.rb_ground_frags_per_death);
            case "gkb":
                return this.toNumber(b.rb_ground_frags_per_battle) - this.toNumber(a.rb_ground_frags_per_battle);
            case "brAsc":
                return this.toNumber(a.rb_br) - this.toNumber(b.rb_br);
            case "brDesc":
                return this.toNumber(b.rb_br) - this.toNumber(a.rb_br);
            case "name":
                return this.rawDisplayName(a).localeCompare(this.rawDisplayName(b));
            case "win":
            default:
                return this.toNumber(b.rb_win_rate) - this.toNumber(a.rb_win_rate);
        }
    }

    private compareTableRows(a: RankedRow, b: RankedRow): number {
        if (!this.tableSort) return 0;
        const direction = this.tableSort.direction;
        switch (this.tableSort.key) {
            case "vehicle":
                return this.compareValues(this.rawDisplayName(a.row), this.rawDisplayName(b.row), direction);
            case "nation":
                return this.compareValues(a.row.nation, b.row.nation, direction);
            case "br":
                return this.compareValues(this.toNullableNumber(a.row.rb_br), this.toNullableNumber(b.row.rb_br), direction);
            case "rank":
                return this.compareValues(a.resultRank, b.resultRank, direction);
            case "win":
                return this.compareValues(this.toNullableNumber(a.row.rb_win_rate), this.toNullableNumber(b.row.rb_win_rate), direction);
            case "battles":
                return this.compareValues(this.toNullableNumber(a.row.rb_battles), this.toNullableNumber(b.row.rb_battles), direction);
            case "gkb":
                return this.compareValues(this.toNullableNumber(a.row.rb_ground_frags_per_battle), this.toNullableNumber(b.row.rb_ground_frags_per_battle), direction);
            case "gkd":
                return this.compareValues(this.toNullableNumber(a.row.rb_ground_frags_per_death), this.toNullableNumber(b.row.rb_ground_frags_per_death), direction);
            case "premium":
                return this.compareValues(this.isPremium(a.row) ? 1 : 0, this.isPremium(b.row) ? 1 : 0, direction);
            default:
                return 0;
        }
    }

    private updateResults(): void {
        const filters = this.filters();
        let results = this.rows
            .filter(row => filters.nation === "all" || row.nation === filters.nation)
            .filter(row => this.toNumber(row.rb_br) >= filters.brMin && this.toNumber(row.rb_br) <= filters.brMax)
            .filter(row => filters.premium === "all" || (filters.premium === "premium") === this.isPremium(row))
            .filter(row => !filters.favoritesOnly || this.favorites.indexOf(row.name) >= 0)
            .filter(row => this.toNumber(row.rb_battles) >= filters.minBattles)
            .filter(row => this.matchesQuery(row, filters.query));

        results = results.sort((a, b) => this.compareRows(a, b));
        const rankedResults = results.map((row, index) => ({ row, resultRank: index + 1 }));
        const tableResults = this.tableSort
            ? rankedResults.slice().sort((a, b) => this.compareTableRows(a, b))
            : rankedResults;
        this.byId("result-count").textContent = `${results.length} ${results.length === 1 ? "vehicle" : "vehicles"}`;
        this.updateTableSortHeaders();

        const tbody = this.byId("ground-results");
        tbody.innerHTML = tableResults.length
            ? tableResults.slice(0, 100).map(item => this.resultRow(item.row, item.resultRank)).join("")
            : `<tr><td class="empty-results" colspan="10">No Ground RB vehicles match the current filters.</td></tr>`;
        Array.prototype.forEach.call(tbody.querySelectorAll("[data-select]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-select"), button));
        });
        Array.prototype.forEach.call(tbody.querySelectorAll("[data-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => {
                this.toggleCompare(button.getAttribute("data-compare"));
                this.openCompareDrawer(button);
            });
        });

        const visible = rankedResults.slice(0, this.visibleCards);
        this.byId("ground-card-view").innerHTML = visible.length
            ? visible.map(item => this.vehicleCard(item.row, item.resultRank)).join("")
            : `<div class="empty-results card-empty">No Ground RB vehicles match the current filters.</div>`;
        this.bindCardButtons(this.byId("ground-card-view"));
        this.debugVisibleImages(visible.map(item => item.row));
        (this.byId("show-more-cards") as HTMLButtonElement).hidden = results.length <= this.visibleCards || this.currentView !== "card";
        const compareCount = this.root.querySelector("#compare-count");
        if (compareCount) compareCount.textContent = String(this.compareNames.length);
        this.syncUrlState();
    }

    private resultRow(row: JoinedRow, rank: number): string {
        const low = this.isLowSample(row);
        const compared = this.compareNames.indexOf(row.name) >= 0;
        return `
            <tr>
                <td><button type="button" data-select="${this.escape(row.name)}">${this.displayName(row)}</button></td>
                <td>${this.escape(row.nation)}</td>
                <td>${this.formatValue(row.rb_br)}</td>
                <td>#${rank}</td>
                <td>${this.formatPercentage(row.rb_win_rate)}</td>
                <td${low ? ` class="low-sample-battles" title="Fewer than ${LOW_SAMPLE_BATTLES} battles; interpret cautiously"` : ""}>${this.formatCount(row.rb_battles)}</td>
                <td>${this.formatRatio(row.rb_ground_frags_per_battle)}</td>
                <td>${this.formatRatio(row.rb_ground_frags_per_death)}</td>
                <td>${this.isPremium(row) ? "Yes" : "No"}</td>
                <td><button type="button" data-compare="${this.escape(row.name)}">${compared ? "Remove" : "Compare"}</button></td>
            </tr>
        `;
    }

    private vehicleCard(row: JoinedRow, rank: number): string {
        const compared = this.compareNames.indexOf(row.name) >= 0;
        const favorite = this.favorites.indexOf(row.name) >= 0;
        const lowSample = this.isLowSample(row);
        return `
            <article class="vehicle-card${this.isPremium(row) ? " premium-card" : ""}${lowSample ? " low-sample-card" : ""}" data-nation="${this.escape(row.nation)}">
                ${this.vehicleArt(row)}
                <div class="vehicle-card-body">
                    <div class="vehicle-card-title-row">
                        <h3>${this.displayName(row)}</h3>
                        <span class="result-rank">#${rank}</span>
                    </div>
                    <dl class="stat-grid">
                        ${this.stat("Battles", this.formatCount(row.rb_battles))}
                        ${this.stat("Win rate", this.formatPercentage(row.rb_win_rate))}
                        ${this.stat("Ground frags", this.formatCount(this.estimatedGroundFrags(row)))}
                        ${this.stat("Deaths", this.formatCount(this.estimatedDeaths(row)))}
                        ${this.stat("Frags / battle", this.formatRatio(row.rb_ground_frags_per_battle))}
                        ${this.stat("Frags / death", this.formatRatio(row.rb_ground_frags_per_death))}
                        ${this.stat("SL / game", this.formatCount(row.rb_sl_rate))}
                        ${this.stat("RP / game", this.formatCount(row.rb_rp_rate))}
                    </dl>
                    <div class="card-caveat-row">${lowSample ? `<p class="card-caveat">Fewer than ${LOW_SAMPLE_BATTLES} battles: interpret cautiously.</p>` : ""}</div>
                    <div class="card-actions">
                        <button type="button" data-select="${this.escape(row.name)}">Details</button>
                        <button type="button" data-compare="${this.escape(row.name)}">${compared ? "Remove" : "Compare"}</button>
                        <button type="button" data-fav-toggle="${this.escape(row.name)}">${favorite ? "Unfavourite" : "Favourite"}</button>
                        <button type="button" data-show-plot="${this.escape(row.name)}">Trends</button>
                    </div>
                </div>
            </article>
        `;
    }

    private selectVehicle(name: string, trigger?: HTMLElement): void {
        const row = this.rows.filter(item => item.name === name)[0];
        if (!row) return;
        this.selected = row;
        this.rememberSearch(this.displayName(row));
        this.renderDetail(row, trigger);
        this.renderMemory();
        this.syncUrlState();
    }

    private openImagePreview(name: string): void {
        const row = this.rows.filter(item => item.name === name)[0];
        if (!row) return;
        const image = this.vehicleImage(row);
        if (!image) return;
        const modal = this.byId("vehicle-image-modal") as HTMLElement;
        const title = this.byId("vehicle-image-title");
        const link = this.byId("vehicle-image-source") as HTMLAnchorElement;
        const preview = this.byId("vehicle-image-preview") as HTMLImageElement;
        const sourceUrl = image.sourceUrl || image.sourcePage || "";
        title.textContent = (row.alt_name || row.wk_name || row.name).replace(/_/g, " ");
        preview.closest(".vehicle-image-dialog")?.classList.remove("image-failed");
        preview.src = image.previewUrl || image.imageUrl;
        preview.alt = `${title.textContent} vehicle image`;
        if (sourceUrl) {
            link.href = sourceUrl;
            link.textContent = image.sourceFileTitle || "Image source";
            link.hidden = false;
        } else {
            link.hidden = true;
        }
        modal.hidden = false;
        document.body.classList.add("modal-open");
        (this.byId("vehicle-image-close") as HTMLButtonElement).focus();
    }

    private closeImagePreview(): void {
        const modal = this.byId("vehicle-image-modal") as HTMLElement;
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove("modal-open");
        (this.byId("vehicle-image-preview") as HTMLImageElement).removeAttribute("src");
    }

    private renderDetail(row: JoinedRow, trigger?: HTMLElement): void {
        const favorites = this.favorites.indexOf(row.name) >= 0;
        const lowSample = this.isLowSample(row);
        const confidence = this.confidence(row);
        this.openDrawer(this.rawDisplayName(row), `
            <div class="drawer-summary-row">
                <span class="confidence confidence-${confidence.label.toLowerCase()}">${confidence.label} confidence · ${confidence.score}/100</span>
                <button type="button" id="open-current-trend">View trends</button>
            </div>
            <div class="detail-actions">
                <button type="button" id="favorite-current">${favorites ? "Unfavorite" : "Favourite"}</button>
                <button type="button" id="compare-current">Add To Comparison</button>
            </div>
            <dl>
                <dt>Nation</dt><dd>${this.escape(row.nation)}</dd>
                <dt>Class</dt><dd>${this.escape(row.cls)}</dd>
                <dt>AB / RB / SB BR</dt><dd>${this.formatValue(row.ab_br)} / ${this.formatValue(row.rb_br)} / ${this.formatValue(row.sb_br)}</dd>
                <dt>RB win rate</dt><dd>${this.formatPercentage(row.rb_win_rate)}</dd>
                <dt>RB battles</dt><dd>${this.formatCount(row.rb_battles)}</dd>
                <dt>RB frags / battle</dt><dd>${this.formatRatio(row.rb_ground_frags_per_battle)}</dd>
                <dt>RB frags / death</dt><dd>${this.formatRatio(row.rb_ground_frags_per_death)}</dd>
                <dt>RB repair</dt><dd>${this.formatCount(row.rb_repair)}</dd>
                <dt>Premium</dt><dd>${this.isPremium(row) ? "Yes" : "No"}</dd>
                <dt>Source update</dt><dd>${this.sourceInfo ? this.escape(this.sourceInfo.latestJoined.date) : "N/A"}</dd>
            </dl>
            <p class="data-caveat">${lowSample ? `Low sample warning: this vehicle has fewer than ${LOW_SAMPLE_BATTLES} battles. ` : ""}Thunderskill data is sample-based and joined data can contain vehicle matching errors.</p>
        `, "details", trigger);
        this.byId("favorite-current").addEventListener("click", () => {
            this.toggleName(this.favorites, row.name, STORAGE_FAVORITES, 99);
            this.renderDetail(row);
            this.renderMemory();
            this.updateResults();
        });
        this.byId("compare-current").addEventListener("click", () => {
            this.toggleCompare(row.name);
            this.openCompareDrawer();
        });
        this.byId("open-current-trend").addEventListener("click", () => this.openTrendDrawer(row.name));
    }

    private renderCompare(): void {
        const drawer = this.root.querySelector("#workspace-drawer") as HTMLElement;
        if (!drawer || drawer.dataset.mode !== "compare" || drawer.hidden) return;
        this.renderCompareContent();
    }

    private renderCompareContent(): void {
        const rows = this.compareNames
            .map(name => this.rows.filter(row => row.name === name)[0])
            .filter(row => row);
        const container = this.byId("workspace-drawer-content");
        if (rows.length === 0) {
            container.innerHTML = "<div class=\"drawer-empty\"><h3>Comparison bench</h3><p>Select two to four vehicles from cards or the table.</p></div>";
            return;
        }
        container.innerHTML = `
            <div class="compare-actions">
                <button type="button" id="copy-comparison">Copy comparison summary</button>
                <button type="button" id="copy-comparison-link">Copy share link</button>
                <button type="button" id="clear-comparison">Clear comparison</button>
            </div>
            <div class="ground-rb-results-wrap">
                <table class="compare-table">
                    <thead><tr><th>Vehicle</th><th>BR</th><th>Win</th><th>Battles</th><th>Frags / battle</th><th>Frags / death</th><th>Repair</th><th>Premium</th><th aria-label="Actions"></th></tr></thead>
                    <tbody>${rows.map(row => `
                        <tr><td>${this.displayName(row)}</td><td>${this.formatValue(row.rb_br)}</td><td>${this.formatPercentage(row.rb_win_rate)}</td><td>${this.formatCount(row.rb_battles)}</td><td>${this.formatRatio(row.rb_ground_frags_per_battle)}</td><td>${this.formatRatio(row.rb_ground_frags_per_death)}</td><td>${this.formatCount(row.rb_repair)}</td><td>${this.isPremium(row) ? "Yes" : "No"}</td><td><button type="button" class="compare-remove" data-remove-compare="${this.escape(row.name)}">Remove</button></td></tr>
                    `).join("")}</tbody>
                </table>
            </div>
        `;
        this.byId("copy-comparison").addEventListener("click", () => this.copyComparison());
        this.byId("copy-comparison-link").addEventListener("click", () => this.copyShareLink());
        this.byId("clear-comparison").addEventListener("click", () => this.clearCompare());
        Array.prototype.forEach.call(container.querySelectorAll("[data-remove-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.removeCompare(button.getAttribute("data-remove-compare")));
        });
    }

    private openDrawer(title: string, content: string, mode: string, trigger?: HTMLElement): void {
        const drawer = this.byId("workspace-drawer") as HTMLElement;
        if (trigger) this.drawerReturnFocus = trigger;
        drawer.dataset.mode = mode;
        this.byId("workspace-drawer-title").textContent = title;
        this.byId("workspace-drawer-content").innerHTML = content;
        drawer.hidden = false;
        document.body.classList.add("drawer-open");
        (this.byId("workspace-drawer-close") as HTMLButtonElement).focus();
    }

    private closeDrawer(): void {
        const drawer = this.root.querySelector("#workspace-drawer") as HTMLElement;
        if (!drawer || drawer.hidden) return;
        drawer.hidden = true;
        document.body.classList.remove("drawer-open");
        this.drawerReturnFocus?.focus();
    }

    private openCompareDrawer(trigger?: HTMLElement): void {
        this.openDrawer("Compare vehicles", "", "compare", trigger);
        this.renderCompareContent();
    }

    private openTrendDrawer(name: string, trigger?: HTMLElement): void {
        const row = this.rows.filter(item => item.name === name)[0];
        if (!row) return;
        const trend = this.trendManifest && this.trendManifest.vehicles[name];
        if (!trend) {
            this.openDrawer(`${this.rawDisplayName(row)} trends`, "<div class=\"drawer-empty\"><p>No historical snapshots are available for this vehicle yet.</p></div>", "trend", trigger);
            return;
        }
        const snapshots: Array<[string, string, TrendMetrics | null]> = [
            ["Latest", this.trendManifest.latestDate, trend.latest],
            ["Previous", this.trendManifest.dates.d1, trend.history.d1],
            ["7-day reference", this.trendManifest.dates.d7, trend.history.d7],
            ["30-day reference", this.trendManifest.dates.d30, trend.history.d30]
        ];
        this.openDrawer(`${this.rawDisplayName(row)} trends`, `
            <div class="trend-deltas">
                ${this.deltaCard("Win rate · 7d", trend.delta7.winRate, "pp")}
                ${this.deltaCard("Frags / death · 7d", trend.delta7.fragsPerDeath, "")}
                ${this.deltaCard("Battles · 7d", trend.delta7.battles, "")}
                ${this.deltaCard("BR · 30d", trend.delta30.br, "")}
            </div>
            <div class="trend-snapshot-grid">
                ${snapshots.map(([label, date, metrics]) => `
                    <section>
                        <span>${label}</span><strong>${this.escape(date)}</strong>
                        <dl>
                            <div><dt>Win</dt><dd>${metrics ? this.formatPercentage(String(metrics.winRate ?? "")) : "N/A"}</dd></div>
                            <div><dt>Battles</dt><dd>${metrics ? this.formatCount(String(metrics.battles ?? "")) : "N/A"}</dd></div>
                            <div><dt>F/D</dt><dd>${metrics ? this.formatRatio(String(metrics.fragsPerDeath ?? "")) : "N/A"}</dd></div>
                            <div><dt>BR</dt><dd>${metrics ? this.formatValue(String(metrics.br ?? "")) : "N/A"}</dd></div>
                        </dl>
                    </section>
                `).join("")}
            </div>
        `, "trend", trigger);
    }

    private deltaCard(label: string, value: number | null, suffix: string): string {
        const number = Number(value);
        const available = value !== null && Number.isFinite(number);
        const direction = available ? number > 0 ? "up" : number < 0 ? "down" : "flat" : "flat";
        const formatted = available ? `${number > 0 ? "+" : ""}${number}${suffix}` : "N/A";
        return `<div class="trend-delta trend-${direction}"><span>${label}</span><strong>${formatted}</strong></div>`;
    }

    private openChangeFeed(trigger?: HTMLElement): void {
        const changes = this.trendManifest ? this.trendManifest.changes.slice(0, 20) : [];
        this.openDrawer("Latest changes", changes.length ? `
            <div class="change-feed">
                ${changes.map(change => `
                    <button type="button" data-change-vehicle="${this.escape(change.id)}">
                        <span><strong>${this.escape(String(change.name).replace(/_/g, " "))}</strong><small>${this.escape(change.nation)} · BR ${change.latest.br ?? "N/A"}</small></span>
                        <span class="change-values">${change.isNew ? "New" : `${this.signed(change.delta7.winRate)} pp WR · ${this.signed(change.delta7.fragsPerDeath)} F/D`}</span>
                    </button>
                `).join("")}
            </div>
        ` : "<div class=\"drawer-empty\"><p>No historical change data is available.</p></div>", "changes", trigger);
        Array.prototype.forEach.call(this.byId("workspace-drawer-content").querySelectorAll("[data-change-vehicle]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.openTrendDrawer(button.getAttribute("data-change-vehicle"), button));
        });
    }

    private signed(value: number | null): string {
        if (value === null || !Number.isFinite(Number(value))) return "N/A";
        return `${Number(value) > 0 ? "+" : ""}${value}`;
    }

    private openLineupBuilder(trigger?: HTMLElement): void {
        const defaultNation = (this.byId("ground-nation") as HTMLSelectElement).value;
        const nation = defaultNation === "all" ? "USA" : defaultNation;
        this.openDrawer("Ground RB lineup builder", `
            <div class="lineup-controls">
                ${this.select("lineup-nation", "Nation", this.nationOptions().filter(option => option[0] !== "all"))}
                ${this.numberInput("lineup-br", "Maximum BR", "1", "13.7", "0.3", (this.byId("ground-br-max") as HTMLInputElement).value)}
                ${this.numberInput("lineup-size", "Vehicles", "3", "8", "1", "5")}
                <button type="button" id="generate-lineup">Generate lineup</button>
            </div>
            <div id="lineup-results"></div>
        `, "lineup", trigger);
        (this.byId("lineup-nation") as HTMLSelectElement).value = nation;
        this.byId("generate-lineup").addEventListener("click", () => this.renderLineupRecommendations());
        this.renderLineupRecommendations();
    }

    private renderLineupRecommendations(): void {
        const nation = (this.byId("lineup-nation") as HTMLSelectElement).value;
        const br = this.toNumber((this.byId("lineup-br") as HTMLInputElement).value);
        const size = Math.max(3, Math.min(8, this.toNumber((this.byId("lineup-size") as HTMLInputElement).value)));
        const candidates = this.rows
            .filter(row => row.nation === nation && this.toNumber(row.rb_br) <= br && this.toNumber(row.rb_battles) >= LOW_SAMPLE_BATTLES)
            .sort((a, b) => this.lineupScore(b, br) - this.lineupScore(a, br));
        const lineup: JoinedRow[] = [];
        const brBands = [0, .3, .7, 1.0];
        brBands.forEach(offset => {
            const candidate = candidates.find(row => this.toNumber(row.rb_br) >= br - offset && lineup.indexOf(row) < 0);
            if (candidate && lineup.length < size) lineup.push(candidate);
        });
        candidates.forEach(row => {
            if (lineup.length < size && lineup.indexOf(row) < 0) lineup.push(row);
        });
        const container = this.byId("lineup-results");
        container.innerHTML = lineup.length ? `
            <div class="lineup-list">
                ${lineup.map((row, index) => `<button type="button" data-lineup-vehicle="${this.escape(row.name)}"><span>#${index + 1}</span><strong>${this.displayName(row)}</strong><small>BR ${this.formatValue(row.rb_br)} · ${this.formatPercentage(row.rb_win_rate)} · ${this.formatRatio(row.rb_ground_frags_per_death)} F/D</small></button>`).join("")}
            </div>
            <button type="button" id="copy-lineup">Copy lineup</button>
        ` : "<div class=\"drawer-empty\"><p>No vehicles meet this nation, BR, and sample threshold.</p></div>";
        Array.prototype.forEach.call(container.querySelectorAll("[data-lineup-vehicle]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-lineup-vehicle"), button));
        });
        const copy = container.querySelector("#copy-lineup");
        if (copy) copy.addEventListener("click", () => this.copyText(lineup.map(row => `${this.rawDisplayName(row)} (BR ${row.rb_br})`).join("\n"), "Lineup copied"));
    }

    private lineupScore(row: JoinedRow, targetBr: number): number {
        const brDistance = Math.max(0, targetBr - this.toNumber(row.rb_br));
        return this.toNumber(row.rb_ground_frags_per_death) * 35
            + this.toNumber(row.rb_ground_frags_per_battle) * 25
            + this.toNumber(row.rb_win_rate) * .4
            + Math.log10(Math.max(10, this.toNumber(row.rb_battles))) * 8
            - brDistance * 18;
    }

    private confidence(row: JoinedRow): { score: number; label: "High" | "Medium" | "Low" } {
        const battles = this.toNumber(row.rb_battles);
        const battleScore = Math.min(65, Math.round(Math.log10(Math.max(1, battles)) / 5 * 65));
        const image = this.vehicleImage(row);
        const imageScore = image ? image.confidence === "high" ? 15 : image.confidence === "medium" ? 10 : 4 : 0;
        const ageDays = this.sourceInfo ? Math.max(0, Math.floor((Date.now() - new Date(`${this.sourceInfo.latestJoined.date}T00:00:00Z`).getTime()) / 86400000)) : 30;
        const freshnessScore = Math.max(0, 20 - ageDays * 2);
        const score = Math.max(0, Math.min(100, battleScore + imageScore + freshnessScore));
        return { score, label: score >= 75 ? "High" : score >= 50 ? "Medium" : "Low" };
    }

    private copyComparison(): void {
        const rows = this.compareNames
            .map(name => this.rows.filter(row => row.name === name)[0])
            .filter(row => row);
        const text = rows.map(row =>
            `${this.displayName(row)}: BR ${this.formatValue(row.rb_br)}, ${this.formatPercentage(row.rb_win_rate)} WR, ${this.formatCount(row.rb_battles)} battles, ${this.formatRatio(row.rb_ground_frags_per_battle)} frags / battle, ${this.formatRatio(row.rb_ground_frags_per_death)} frags / death`
        ).join("\n");
        this.copyText(text, "Comparison copied");
    }

    private copyShareLink(): void {
        this.syncUrlState();
        this.copyText(window.location.href, "Share link copied");
    }

    private copyText(text: string, message: string): void {
        const fallback = () => {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
            this.toast(message);
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => this.toast(message)).catch(fallback);
        } else {
            fallback();
        }
    }

    private toast(message: string): void {
        const toast = this.byId("app-toast") as HTMLElement;
        toast.textContent = message;
        toast.hidden = false;
        window.setTimeout(() => {
            toast.hidden = true;
        }, 2200);
    }

    private applyPreset(preset: string): void {
        (this.byId("ground-nation") as HTMLSelectElement).value = "all";
        (this.byId("ground-br-min") as HTMLInputElement).value = "0";
        (this.byId("ground-br-max") as HTMLInputElement).value = "13.7";
        (this.byId("ground-premium") as HTMLSelectElement).value = preset === "premium" ? "premium" : "all";
        (this.byId("ground-favorites") as HTMLSelectElement).value = "all";
        (this.byId("ground-min-battles") as HTMLInputElement).value = preset === "sample" ? "2000" : "400";
        (this.byId("ground-search") as HTMLInputElement).value = "";
        this.currentSort = preset === "played" ? "played" : preset === "frags" ? "gkb" : preset === "win" ? "win" : "gkd";
        (this.byId("ground-sort") as HTMLSelectElement).value = this.currentSort;
        this.visibleCards = CARD_PAGE_SIZE;
        this.updateResults();
    }

    private filters(): Filters {
        return {
            nation: (this.byId("ground-nation") as HTMLSelectElement).value,
            brMin: this.toNumber((this.byId("ground-br-min") as HTMLInputElement).value),
            brMax: this.toNumber((this.byId("ground-br-max") as HTMLInputElement).value),
            premium: (this.byId("ground-premium") as HTMLSelectElement).value,
            minBattles: this.toNumber((this.byId("ground-min-battles") as HTMLInputElement).value),
            query: (this.byId("ground-search") as HTMLInputElement).value,
            favoritesOnly: (this.byId("ground-favorites") as HTMLSelectElement).value === "favorites"
        };
    }

    private matchesQuery(row: JoinedRow, query: string): boolean {
        const normalized = this.normalize(query);
        if (!normalized) return true;
        return [row.name, row.wk_name, row.alt_name, this.displayName(row)]
            .some(value => this.normalize(value).indexOf(normalized) >= 0);
    }

    private applyUrlSelection(): void {
        const name = new URLSearchParams(window.location.search).get("vehicle");
        if (name) {
            const row = this.rows.filter(item => item.name === name)[0];
            if (row) this.selected = row;
        }
    }

    private renderMemory(): void {
        const recent = this.root.querySelector("#recent-searches");
        const favorites = this.root.querySelector("#favorite-vehicles");
        if (recent) {
            recent.innerHTML = this.recentSearches.slice(0, 5).map(text => `
                <span class="memory-chip">
                    <button type="button" class="chip-main" data-memory="${this.escape(text)}">${this.escape(text)}</button>
                    <button type="button" class="chip-remove" data-remove-recent="${this.escape(text)}" aria-label="Remove ${this.escape(text)} from recent searches">x</button>
                </span>
            `).join("") + (this.recentSearches.length ? `<button type="button" class="clear-memory" id="clear-recent-searches">Clear</button>` : "");
        }
        if (favorites) favorites.innerHTML = this.favorites.slice(0, 8).map(name => {
            const row = this.rows.filter(item => item.name === name)[0];
            return row ? `<button type="button" data-favorite="${this.escape(row.name)}">${this.displayName(row)}</button>` : "";
        }).join("");
        Array.prototype.forEach.call(this.root.querySelectorAll("[data-memory]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => {
                (this.byId("ground-search") as HTMLInputElement).value = button.getAttribute("data-memory") || "";
                this.updateResults();
            });
        });
        Array.prototype.forEach.call(this.root.querySelectorAll("[data-remove-recent]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => {
                const value = button.getAttribute("data-remove-recent") || "";
                this.recentSearches = this.recentSearches.filter(item => item !== value);
                localStorage.setItem(STORAGE_RECENT, JSON.stringify(this.recentSearches));
                this.renderMemory();
            });
        });
        const clearRecent = this.root.querySelector("#clear-recent-searches");
        if (clearRecent) {
            clearRecent.addEventListener("click", () => {
                this.recentSearches = [];
                localStorage.setItem(STORAGE_RECENT, JSON.stringify(this.recentSearches));
                this.renderMemory();
            });
        }
        Array.prototype.forEach.call(this.root.querySelectorAll("[data-favorite]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-favorite"), button));
        });
    }

    private toggleCompare(name: string): void {
        if (!name) return;
        if (this.compareNames.indexOf(name) >= 0) {
            this.compareNames = this.compareNames.filter(item => item !== name);
        } else if (this.compareNames.length < 4) {
            this.compareNames.push(name);
        }
        localStorage.setItem(STORAGE_COMPARE, JSON.stringify(this.compareNames));
        this.renderCompare();
        this.updateResults();
    }

    private removeCompare(name: string): void {
        if (!name) return;
        this.compareNames = this.compareNames.filter(item => item !== name);
        localStorage.setItem(STORAGE_COMPARE, JSON.stringify(this.compareNames));
        this.renderCompare();
        this.updateResults();
    }

    private clearCompare(): void {
        this.compareNames = [];
        localStorage.setItem(STORAGE_COMPARE, JSON.stringify(this.compareNames));
        this.renderCompare();
        this.updateResults();
    }

    private toggleName(list: string[], name: string, key: string, limit: number): void {
        const exists = list.indexOf(name) >= 0;
        const next = exists ? list.filter(item => item !== name) : [name].concat(list).slice(0, limit);
        if (key === STORAGE_FAVORITES) this.favorites = next;
        localStorage.setItem(key, JSON.stringify(next));
    }

    private rememberSearch(text: string): void {
        this.recentSearches = [text]
            .concat(this.recentSearches.filter(item => item !== text))
            .slice(0, 8);
        localStorage.setItem(STORAGE_RECENT, JSON.stringify(this.recentSearches));
    }

    private parseCsv(csv: string): JoinedRow[] {
        const lines = csv.trim().split(/\r?\n/);
        const headers = this.parseCsvLine(lines.shift() || "");
        return lines.map(line => {
            const values = this.parseCsvLine(line);
            const row: any = {};
            headers.forEach((header, index) => row[header] = values[index] || "");
            return row as JoinedRow;
        });
    }

    private parseCsvLine(line: string): string[] {
        const out: string[] = [];
        let current = "";
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === "\"") {
                if (quoted && line[i + 1] === "\"") {
                    current += "\"";
                    i++;
                } else {
                    quoted = !quoted;
                }
            } else if (char === "," && !quoted) {
                out.push(current);
                current = "";
            } else {
                current += char;
            }
        }
        out.push(current);
        return out;
    }

    private requireOk(response: Response, name: string): Response {
        if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}.`);
        return response;
    }

    private async loadRows(): Promise<JoinedRow[]> {
        try {
            const response = await fetch("data/latest-joined.json");
            if (response.ok) return await response.json();
        } catch {
            // Fall through to the legacy CSV for older or partial deployments.
        }
        const response = await fetch("data/latest-joined.csv");
        return this.parseCsv(await this.requireOk(response, "data/latest-joined.csv").text());
    }

    private async loadImageManifest(): Promise<VehicleImageManifest | null> {
        try {
            const response = await fetch("data/vehicle-images.json");
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    private async loadTrendManifest(): Promise<TrendManifest | null> {
        try {
            const response = await fetch("data/vehicle-trends.json");
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    private readList(key: string): string[] {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    private readTableSort(): TableSort | null {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_TABLE_SORT) || "null");
            const keys: TableSortKey[] = ["vehicle", "nation", "br", "rank", "win", "battles", "gkb", "gkd", "premium"];
            if (!value || keys.indexOf(value.key) < 0 || (value.direction !== "asc" && value.direction !== "desc")) {
                return null;
            }
            return value as TableSort;
        } catch {
            return null;
        }
    }

    private readPresets(): SavedPreset[] {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_PRESETS) || "[]");
            return Array.isArray(value) ? value.slice(0, 20) : [];
        } catch {
            return [];
        }
    }

    private savedPresetOptions(): string {
        return `<option value="">Choose preset</option>${this.savedPresets.map((preset, index) => `<option value="${index}">${this.escape(preset.name)}</option>`).join("")}`;
    }

    private refreshSavedPresetSelect(): void {
        const select = this.root.querySelector("#saved-preset-select") as HTMLSelectElement;
        if (select) select.innerHTML = this.savedPresetOptions();
    }

    private saveCurrentPreset(): void {
        const suggested = `Preset ${this.savedPresets.length + 1}`;
        const name = window.prompt("Preset name", suggested);
        if (!name || !name.trim()) return;
        const preset: SavedPreset = { name: name.trim(), filters: this.filters(), sort: this.currentSort, view: this.currentView };
        const existing = this.savedPresets.findIndex(item => item.name.toLowerCase() === preset.name.toLowerCase());
        if (existing >= 0) this.savedPresets[existing] = preset;
        else this.savedPresets.push(preset);
        this.savedPresets = this.savedPresets.slice(0, 20);
        localStorage.setItem(STORAGE_PRESETS, JSON.stringify(this.savedPresets));
        this.refreshSavedPresetSelect();
        this.toast("Preset saved");
    }

    private deleteSavedPreset(): void {
        const select = this.byId("saved-preset-select") as HTMLSelectElement;
        if (select.value === "") return;
        this.savedPresets.splice(Number(select.value), 1);
        localStorage.setItem(STORAGE_PRESETS, JSON.stringify(this.savedPresets));
        this.refreshSavedPresetSelect();
        this.toast("Preset deleted");
    }

    private applySavedPreset(): void {
        const select = this.byId("saved-preset-select") as HTMLSelectElement;
        if (select.value === "") return;
        const preset = this.savedPresets[Number(select.value)];
        if (!preset) return;
        this.applyFilterValues(preset.filters);
        this.currentSort = preset.sort;
        (this.byId("ground-sort") as HTMLSelectElement).value = preset.sort;
        this.setView(preset.view);
        this.toast("Preset applied");
    }

    private exportSavedPresets(): void {
        const blob = new Blob([JSON.stringify({ version: 1, presets: this.savedPresets }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "wt-ground-rb-presets.json";
        link.click();
        URL.revokeObjectURL(url);
        this.toast("Presets exported");
    }

    private importSavedPresets(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || "{}"));
                if (!Array.isArray(parsed.presets)) throw new Error("invalid preset file");
                this.savedPresets = parsed.presets.slice(0, 20);
                localStorage.setItem(STORAGE_PRESETS, JSON.stringify(this.savedPresets));
                this.refreshSavedPresetSelect();
                this.toast("Presets imported");
            } catch {
                this.toast("Preset import failed");
            }
            input.value = "";
        };
        reader.readAsText(file);
    }

    private applyFilterValues(filters: Filters): void {
        (this.byId("ground-nation") as HTMLSelectElement).value = filters.nation || "all";
        (this.byId("ground-br-min") as HTMLInputElement).value = String(filters.brMin ?? 0);
        (this.byId("ground-br-max") as HTMLInputElement).value = String(filters.brMax ?? 13.7);
        (this.byId("ground-premium") as HTMLSelectElement).value = filters.premium || "all";
        (this.byId("ground-favorites") as HTMLSelectElement).value = filters.favoritesOnly ? "favorites" : "all";
        (this.byId("ground-min-battles") as HTMLInputElement).value = String(filters.minBattles ?? LOW_SAMPLE_BATTLES);
        (this.byId("ground-search") as HTMLInputElement).value = filters.query || "";
    }

    private applyUrlState(): void {
        const params = new URLSearchParams(window.location.search);
        const filters: Filters = {
            nation: params.get("nation") || "all",
            brMin: this.toNumber(params.get("brMin") || "0"),
            brMax: this.toNumber(params.get("brMax") || "13.7"),
            premium: params.get("premium") || "all",
            minBattles: this.toNumber(params.get("battles") || String(LOW_SAMPLE_BATTLES)),
            query: params.get("q") || "",
            favoritesOnly: params.get("favorites") === "1"
        };
        this.applyFilterValues(filters);
        const sorts: SortMode[] = ["win", "played", "gkd", "gkb", "brAsc", "brDesc", "name"];
        const sort = params.get("sort") as SortMode;
        if (sorts.indexOf(sort) >= 0) this.currentSort = sort;
        (this.byId("ground-sort") as HTMLSelectElement).value = this.currentSort;
        this.currentView = params.get("view") === "table" ? "table" : "card";
        (this.byId("ground-card-view") as HTMLElement).hidden = this.currentView !== "card";
        (this.byId("ground-table-view") as HTMLElement).hidden = this.currentView !== "table";
        this.byId("view-card").setAttribute("aria-pressed", String(this.currentView === "card"));
        this.byId("view-table").setAttribute("aria-pressed", String(this.currentView === "table"));
        const compare = (params.get("compare") || "").split(",").filter(Boolean);
        if (compare.length) this.compareNames = compare.slice(0, 4);
    }

    private syncUrlState(): void {
        if (!this.root || !this.root.querySelector("#ground-nation")) return;
        const filters = this.filters();
        const params = new URLSearchParams();
        if (filters.nation !== "all") params.set("nation", filters.nation);
        if (filters.brMin !== 0) params.set("brMin", String(filters.brMin));
        if (filters.brMax !== 13.7) params.set("brMax", String(filters.brMax));
        if (filters.premium !== "all") params.set("premium", filters.premium);
        if (filters.minBattles !== LOW_SAMPLE_BATTLES) params.set("battles", String(filters.minBattles));
        if (filters.query) params.set("q", filters.query);
        if (filters.favoritesOnly) params.set("favorites", "1");
        if (this.currentSort !== "gkd") params.set("sort", this.currentSort);
        if (this.currentView !== "card") params.set("view", this.currentView);
        if (this.selected) params.set("vehicle", this.selected.name);
        if (this.compareNames.length) params.set("compare", this.compareNames.join(","));
        if (new URLSearchParams(window.location.search).get("debugImages") === "1") params.set("debugImages", "1");
        const query = params.toString();
        history.replaceState(null, document.title, `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }

    private nationOptions(): Array<[string, string]> {
        const nations = this.metadata ? ["all", "USA", "Germany", "USSR", "Britain", "Japan", "France", "Italy", "China", "Sweden", "Israel"] : ["all"];
        return nations.map(nation => [nation, nation === "all" ? "All nations" : nation]);
    }

    private tableHeader(key: TableSortKey, label: string): string {
        const active = this.tableSort && this.tableSort.key === key;
        const direction = active ? this.tableSort.direction : null;
        const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
        const indicator = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "";
        return `
            <th data-sort-key="${key}" aria-sort="${ariaSort}">
                <button type="button" class="table-sort-button${active ? " is-active" : ""}" data-table-sort="${key}">
                    <span>${label}</span>
                    <span class="sort-indicator" aria-hidden="true">${indicator}</span>
                </button>
            </th>
        `;
    }

    private button(id: string, text: string): string {
        return `<button type="button" id="${id}">${text}</button>`;
    }

    private select(id: string, label: string, options: Array<[string, string]>): string {
        return `<label>${label}<select id="${id}" aria-label="${label}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></label>`;
    }

    private selectBare(id: string, options: Array<[string, string]>): string {
        return `<select id="${id}" aria-label="Sort vehicles">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>`;
    }

    private numberInput(id: string, label: string, min: string, max: string, step: string, value: string): string {
        return `<label>${label}<input id="${id}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    }

    private stat(label: string, value: string): string {
        return `<div><dt>${label}</dt><dd>${value === "" || value === undefined || value === null ? "N/A" : this.escape(String(value))}</dd></div>`;
    }

    private vehicleArt(row: JoinedRow): string {
        const image = this.vehicleImage(row);
        const placeholder = `
            <div class="vehicle-art-placeholder" aria-hidden="true">
                <div class="vehicle-art-mark">${this.escape(row.nation.slice(0, 3).toUpperCase())}</div>
                <div class="vehicle-art-name">${this.formatValue(row.rb_br)}</div>
            </div>
        `;
        if (!image) {
            return `<div class="vehicle-art">${placeholder}</div>`;
        }
        const fallback = image.sourceKind === "vehicle-page-image" ? image.fallbackImageUrl : "";
        const fitClass = this.imageFitClass(image);
        const focalX = Number(image.focalX ?? (image.sourceKind === "vehicle-page-image" ? 42 : 50));
        const focalY = Number(image.focalY ?? 50);
        const zoom = Number(image.zoom ?? (image.sourceKind === "vehicle-page-image" ? 1.18 : 1));
        const imageStyle = `--image-shift-x:${50 - focalX}%;--image-shift-y:${50 - focalY}%;--image-zoom:${zoom}`;
        return `
            <div class="vehicle-art has-image" data-image-source="${this.escape(image.sourceKind)}" data-image-score="${this.escape(String(image.score || 0))}">
                <button type="button" class="vehicle-image-button" data-image-preview="${this.escape(row.name)}" aria-label="Open ${this.displayName(row)} image preview">
                    <img class="${fitClass}" style="${imageStyle}" src="${this.escape(image.thumbnailUrl || image.imageUrl)}" data-fallback-src="${this.escape(fallback || "")}" alt="${this.displayName(row)} vehicle image" loading="lazy" onerror="if (this.dataset.fallbackSrc) { this.src = this.dataset.fallbackSrc; this.dataset.fallbackSrc = ''; this.classList.add('fit-contain'); this.closest('.vehicle-art').classList.add('using-fallback-image'); } else { this.closest('.vehicle-art').classList.add('image-failed'); this.remove(); }">
                </button>
                <div class="vehicle-art-overlay" aria-hidden="true"></div>
                <div class="vehicle-art-badges" aria-hidden="true">
                    <span>${this.escape(row.nation)}</span>
                    <span>BR ${this.formatValue(row.rb_br)}</span>
                    ${this.isPremium(row) ? "<span class=\"premium-badge\">Premium</span>" : ""}
                </div>
                ${placeholder}
            </div>
        `;
    }

    private vehicleImage(row: JoinedRow): VehicleImage | null {
        if (!this.imageManifest || !this.imageManifest.images) return null;
        const image = this.imageManifest.images[row.name] || this.imageManifest.images[row.wk_name];
        if (!image || !image.imageUrl) return null;
        if (image.sourceKind === "vehicle-page-image" && (image.confidence === "high" || image.confidence === "medium")) return image;
        if (image.sourceKind === "wiki-slot-thumbnail") return image;
        return image;
    }

    private imageSourceCopy(): string {
        if (!this.imageManifest) {
            return "Vehicle image manifest is optional and was not loaded, so cards fall back to local placeholder panels.";
        }
        const source = this.imageManifest.source;
        return `Vehicle card images prefer higher-quality best-effort vehicle-page images from <a href="${this.escape(source.groundPage)}">${this.escape(source.name)}</a>, with official wiki slot thumbnails from <a href="${this.escape(source.cdn)}">the wiki CDN</a> as fallbacks. ${this.escape(String(this.imageManifest.stats.vehiclePageImages || 0))} use vehicle-page images, ${this.escape(String(this.imageManifest.stats.slotThumbnails || 0))} use slot thumbnails, and ${this.escape(String(this.imageManifest.stats.placeholders || 0))} use placeholders. Matching is based on joined vehicle ids and can miss renamed or unavailable vehicles. Images are referenced remotely rather than copied into this AGPL repository.`;
    }

    private imageFitClass(image: VehicleImage): string {
        const width = Number(image.imageWidth || 0);
        const height = Number(image.imageHeight || 0);
        const ratio = width && height ? width / height : 0;
        if (image.sourceKind === "wiki-slot-thumbnail" || width < 640 || ratio < 1.2 || ratio > 2.2) {
            return "fit-contain";
        }
        return "fit-cover";
    }

    private debugVisibleImages(rows: JoinedRow[]): void {
        if (new URLSearchParams(window.location.search).get("debugImages") !== "1") return;
        if (!this.imageManifest || !console.table) return;
        console.table(rows.map(row => {
            const image = this.vehicleImage(row);
            return {
                vehicle: this.displayName(row).replace(/&quot;/g, "\"").replace(/&amp;/g, "&"),
                id: row.name,
                sourceKind: image ? image.sourceKind : "placeholder",
                confidence: image ? image.confidence : "low",
                score: image ? image.score : 0,
                dimensions: image ? `${image.imageWidth || 0}x${image.imageHeight || 0}` : "0x0",
                sourceFileTitle: image ? image.sourceFileTitle : ""
            };
        }));
    }

    private typeLabel(row: JoinedRow): string {
        return row.cls === "Ground_vehicles" ? "Ground vehicle" : row.cls || "Type N/A";
    }

    private estimatedGroundFrags(row: JoinedRow): string {
        const battles = this.toNumber(row.rb_battles);
        const perBattle = this.toNumber(row.rb_ground_frags_per_battle);
        const estimate = Math.round(battles * perBattle);
        return estimate > 0 ? `${estimate}` : "N/A";
    }

    private estimatedDeaths(row: JoinedRow): string {
        const frags = this.toNumber(this.estimatedGroundFrags(row));
        const perDeath = this.toNumber(row.rb_ground_frags_per_death);
        const estimate = perDeath > 0 ? Math.round(frags / perDeath) : 0;
        return estimate > 0 ? `${estimate}` : "N/A";
    }

    private isLowSample(row: JoinedRow): boolean {
        return this.toNumber(row.rb_battles) > 0 && this.toNumber(row.rb_battles) < LOW_SAMPLE_BATTLES;
    }

    private byId(id: string): HTMLElement {
        return this.root.querySelector(`#${id}`) as HTMLElement;
    }

    private updateTableSortHeaders(): void {
        Array.prototype.forEach.call(this.root.querySelectorAll("[data-sort-key]"), (header: HTMLTableCellElement) => {
            const key = header.getAttribute("data-sort-key") as TableSortKey;
            const button = header.querySelector(".table-sort-button");
            const indicator = header.querySelector(".sort-indicator");
            const active = this.tableSort && this.tableSort.key === key;
            const direction = active ? this.tableSort.direction : null;
            header.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
            if (button) button.classList.toggle("is-active", Boolean(active));
            if (indicator) indicator.textContent = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "";
        });
    }

    private defaultTableSortDirection(key: TableSortKey): SortDirection {
        return key === "vehicle" || key === "nation" || key === "br" || key === "rank" ? "asc" : "desc";
    }

    private compareValues(a: string | number | null, b: string | number | null, direction: SortDirection): number {
        const aMissing = this.isMissing(a);
        const bMissing = this.isMissing(b);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;

        let result = 0;
        if (typeof a === "string" || typeof b === "string") {
            result = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
        } else {
            result = a < b ? -1 : a > b ? 1 : 0;
        }
        return direction === "asc" ? result : -result;
    }

    private isMissing(value: string | number | null): boolean {
        return value === null || value === undefined || value === "" || (typeof value === "number" && isNaN(value));
    }

    private rawDisplayName(row: JoinedRow): string {
        return (row.alt_name || row.wk_name || row.name).replace(/_/g, " ");
    }

    private displayName(row: JoinedRow): string {
        return this.escape(this.rawDisplayName(row));
    }

    private isPremium(row: JoinedRow): boolean {
        return String(row.is_premium).toLowerCase() === "true";
    }

    private toNumber(value: string): number {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }

    private toNullableNumber(value: string): number | null {
        if (value === "" || value === undefined || value === null) return null;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
    }

    private formatValue(value: string): string {
        return value === "" || value === undefined || value === null ? "N/A" : this.escape(String(value));
    }

    private formatCount(value: string | number): string {
        if (value === "" || value === undefined || value === null) return "N/A";
        const num = typeof value === "string" ? parseFloat(value) : value;
        if (isNaN(num)) return "N/A";
        return Math.round(num).toLocaleString("en-US");
    }

    private formatPercentage(value: string | number): string {
        if (value === "" || value === undefined || value === null) return "N/A";
        const num = typeof value === "string" ? parseFloat(value) : value;
        if (isNaN(num)) return "N/A";
        return `${Math.round(num)}%`;
    }

    private formatRatio(value: string | number): string {
        if (value === "" || value === undefined || value === null) return "N/A";
        const num = typeof value === "string" ? parseFloat(value) : value;
        if (isNaN(num)) return "N/A";
        return num.toFixed(2);
    }

    private normalize(value: string): string {
        return String(value || "").toLowerCase().replace(/[^a-z0-9а-яё]/gi, "");
    }

    private formatDate(value: string): string {
        return value ? this.escape(value.slice(0, 10)) : "N/A";
    }

    private escape(value: string): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
}

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
};

const STORAGE_RECENT = "wt-ground-rb-recent-searches";
const STORAGE_FAVORITES = "wt-ground-rb-favorites";
const STORAGE_COMPARE = "wt-ground-rb-compare";
const STORAGE_TABLE_SORT = "wt-ground-rb-table-sort";
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
    private selected: JoinedRow | null = null;
    private compareNames: string[] = [];
    private favorites: string[] = [];
    private recentSearches: string[] = [];
    private currentSort: SortMode = "gkd";
    private currentView: ViewMode = "card";
    private tableSort: TableSort | null = null;
    private visibleCards = CARD_PAGE_SIZE;

    constructor(metadata: Metadata[]) {
        this.metadata = metadata;
        this.compareNames = this.readList(STORAGE_COMPARE);
        this.favorites = this.readList(STORAGE_FAVORITES);
        this.recentSearches = this.readList(STORAGE_RECENT);
        this.tableSort = this.readTableSort();
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
            const [csv, sourceInfo] = await Promise.all([
                fetch("data/latest-joined.csv").then(response => this.requireOk(response, "data/latest-joined.csv")).then(response => response.text()),
                fetch("data/source-info.json").then(response => this.requireOk(response, "data/source-info.json")).then(response => response.json())
            ]);
            this.sourceInfo = sourceInfo;
            this.imageManifest = await this.loadImageManifest();
            this.rows = this.parseCsv(csv)
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
                    ${this.numberInput("ground-min-battles", "Min battles", "0", "100000", "100", "500")}
                    <label class="search-label">Vehicle search
                        <input id="ground-search" type="search" placeholder="XM1, Leopard 2, T-80..." autocomplete="off" aria-label="Search vehicles">
                    </label>
                </div>
                <div class="search-memory">
                    <div><strong>Recent searches</strong><span id="recent-searches"></span></div>
                    <div><strong>Favourite vehicles</strong><span id="favorite-vehicles"></span></div>
                </div>
            </details>
            <div class="results-toolbar" aria-label="Vehicle result display controls">
                <div class="results-title">
                    <span class="eyebrow">Filtered results</span>
                    <strong id="result-count"></strong>
                </div>
                <div class="results-controls">
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
            <div class="ground-panels">
                <article id="vehicle-detail" class="vehicle-detail" aria-live="polite"></article>
                <article id="vehicle-compare" class="vehicle-compare"></article>
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
        `;
        this.bindEvents();
        this.renderMemory();
        this.updateResults();
        this.renderCompare();
    }

    private bindEvents(): void {
        ["ground-nation", "ground-br-min", "ground-br-max", "ground-premium", "ground-min-battles", "ground-search"]
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
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") this.closeImagePreview();
        });
        this.bindTableHeaderSort();

        this.byId("preset-win").addEventListener("click", () => this.applyPreset("win"));
        this.byId("preset-played").addEventListener("click", () => this.applyPreset("played"));
        this.byId("preset-frags").addEventListener("click", () => this.applyPreset("frags"));
        this.byId("preset-premium").addEventListener("click", () => this.applyPreset("premium"));
        this.byId("preset-sample").addEventListener("click", () => this.applyPreset("sample"));

        const copyButton = this.root.querySelector("#copy-comparison");
        if (copyButton) {
            copyButton.addEventListener("click", () => this.copyComparison());
        }
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
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-select")));
        });
        Array.prototype.forEach.call(container.querySelectorAll("[data-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.toggleCompare(button.getAttribute("data-compare")));
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
            button.addEventListener("click", () => this.showLegacyPlot(button.getAttribute("data-show-plot")));
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
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-select")));
        });
        Array.prototype.forEach.call(tbody.querySelectorAll("[data-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.toggleCompare(button.getAttribute("data-compare")));
        });

        const visible = rankedResults.slice(0, this.visibleCards);
        this.byId("ground-card-view").innerHTML = visible.length
            ? visible.map(item => this.vehicleCard(item.row, item.resultRank)).join("")
            : `<div class="empty-results card-empty">No Ground RB vehicles match the current filters.</div>`;
        this.bindCardButtons(this.byId("ground-card-view"));
        this.debugVisibleImages(visible.map(item => item.row));
        (this.byId("show-more-cards") as HTMLButtonElement).hidden = results.length <= this.visibleCards || this.currentView !== "card";
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
                    <div class="badge-row">
                        <span>BR ${this.formatValue(row.rb_br)}</span>
                        <span>${this.escape(row.nation)}</span>
                        <span>${this.escape(this.typeLabel(row))}</span>
                        <span>Rank N/A</span>
                        ${this.isPremium(row) ? "<span class=\"premium-badge\">Premium</span>" : ""}
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
                        <button type="button" data-show-plot="${this.escape(row.name)}">Show plot</button>
                    </div>
                </div>
            </article>
        `;
    }

    private selectVehicle(name: string): void {
        const row = this.rows.filter(item => item.name === name)[0];
        if (!row) return;
        this.selected = row;
        this.rememberSearch(this.displayName(row));
        const params = new URLSearchParams(window.location.search);
        params.set("vehicle", row.name);
        history.replaceState(null, document.title, `${window.location.pathname}?${params.toString()}${window.location.hash}`);
        this.renderDetail(row);
        this.renderMemory();
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

    private renderDetail(row: JoinedRow): void {
        const favorites = this.favorites.indexOf(row.name) >= 0;
        const lowSample = this.isLowSample(row);
        this.byId("vehicle-detail").innerHTML = `
            <span class="eyebrow">Selected vehicle</span>
            <h3>${this.displayName(row)}</h3>
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
        `;
        this.byId("favorite-current").addEventListener("click", () => {
            this.toggleName(this.favorites, row.name, STORAGE_FAVORITES, 99);
            this.renderDetail(row);
            this.renderMemory();
        });
        this.byId("compare-current").addEventListener("click", () => this.toggleCompare(row.name));
    }

    private renderCompare(): void {
        const rows = this.compareNames
            .map(name => this.rows.filter(row => row.name === name)[0])
            .filter(row => row);
        const container = this.byId("vehicle-compare");
        if (rows.length === 0) {
            container.innerHTML = "<span class=\"eyebrow\">Compare</span><h3>Comparison bench</h3><p>Select 2 to 4 vehicles to compare.</p>";
            return;
        }
        container.innerHTML = `
            <span class="eyebrow">Compare</span>
            <h3>Comparison bench</h3>
            <div class="compare-actions">
                <button type="button" id="copy-comparison">Copy comparison summary</button>
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
        this.byId("clear-comparison").addEventListener("click", () => this.clearCompare());
        Array.prototype.forEach.call(container.querySelectorAll("[data-remove-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.removeCompare(button.getAttribute("data-remove-compare")));
        });
    }

    private copyComparison(): void {
        const rows = this.compareNames
            .map(name => this.rows.filter(row => row.name === name)[0])
            .filter(row => row);
        const text = rows.map(row =>
            `${this.displayName(row)}: BR ${this.formatValue(row.rb_br)}, ${this.formatPercentage(row.rb_win_rate)} WR, ${this.formatCount(row.rb_battles)} battles, ${this.formatRatio(row.rb_ground_frags_per_battle)} frags / battle, ${this.formatRatio(row.rb_ground_frags_per_death)} frags / death`
        ).join("\n");
        navigator.clipboard?.writeText(text);
    }

    private applyPreset(preset: string): void {
        (this.byId("ground-nation") as HTMLSelectElement).value = "all";
        (this.byId("ground-br-min") as HTMLInputElement).value = "0";
        (this.byId("ground-br-max") as HTMLInputElement).value = "13.7";
        (this.byId("ground-premium") as HTMLSelectElement).value = preset === "premium" ? "premium" : "all";
        (this.byId("ground-min-battles") as HTMLInputElement).value = preset === "sample" ? "2000" : "500";
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
            query: (this.byId("ground-search") as HTMLInputElement).value
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
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-favorite")));
        });
        if (this.selected) this.renderDetail(this.selected);
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

    private async loadImageManifest(): Promise<VehicleImageManifest | null> {
        try {
            const response = await fetch("data/vehicle-images.json");
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
        return `
            <div class="vehicle-art has-image" data-image-source="${this.escape(image.sourceKind)}" data-image-score="${this.escape(String(image.score || 0))}">
                <button type="button" class="vehicle-image-button" data-image-preview="${this.escape(row.name)}" aria-label="Open ${this.displayName(row)} image preview">
                    <img class="${fitClass}" src="${this.escape(image.thumbnailUrl || image.imageUrl)}" data-fallback-src="${this.escape(fallback || "")}" alt="${this.displayName(row)} vehicle image" loading="lazy" onerror="if (this.dataset.fallbackSrc) { this.src = this.dataset.fallbackSrc; this.dataset.fallbackSrc = ''; this.classList.add('fit-contain'); this.closest('.vehicle-art').classList.add('using-fallback-image'); } else { this.closest('.vehicle-art').classList.add('image-failed'); this.remove(); }">
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

    private showLegacyPlot(name: string): void {
        const row = this.rows.filter(item => item.name === name)[0];
        if (!row) return;
        const classSelect = document.getElementById("class-selection") as HTMLSelectElement;
        const modeSelect = document.getElementById("mode-selection") as HTMLSelectElement;
        const brRangeSelect = document.getElementById("br-range-selection") as HTMLSelectElement;
        const viewSelect = document.getElementById("view-mode-selection") as HTMLSelectElement;
        if (viewSelect) {
            viewSelect.value = "heatmap";
            localStorage.setItem("view-mode-selection", "heatmap");
            viewSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (classSelect) classSelect.value = "Ground_vehicles";
        if (modeSelect) modeSelect.value = "rb";
        if (brRangeSelect) {
            brRangeSelect.value = "0";
            localStorage.setItem("br-range-selection", "0");
            brRangeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const target = document.getElementById("main-svg") || document.getElementById("content");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        this.selectVehicle(row.name);
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

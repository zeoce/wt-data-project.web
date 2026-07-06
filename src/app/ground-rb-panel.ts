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

export class GroundRbPanel {
    private root: HTMLElement;
    private rows: JoinedRow[] = [];
    private metadata: Metadata[];
    private sourceInfo: SourceInfo | null = null;
    private selected: JoinedRow | null = null;
    private compareNames: string[] = [];
    private favorites: string[] = [];
    private recentSearches: string[] = [];

    constructor(metadata: Metadata[]) {
        this.metadata = metadata;
        this.compareNames = this.readList(STORAGE_COMPARE);
        this.favorites = this.readList(STORAGE_FAVORITES);
        this.recentSearches = this.readList(STORAGE_RECENT);
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
            <div class="data-status" role="status" aria-live="polite">
                <strong>Data ready</strong>
                <span>${this.rows.length} Ground RB vehicles loaded.</span>
                <small>Latest joined data: ${latest ? this.escape(latest.date) : "N/A"} from /data/metadata.json</small>
            </div>
            <details class="ground-rb-filters" open>
                <summary>Ground RB quick start</summary>
                <div class="ground-rb-intro">
                    <p>Start with Realistic Battles ground vehicles, filter out thin samples, then click a vehicle for detail or add up to four vehicles to compare.</p>
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
                    ${this.numberInput("ground-br-min", "BR min", "1", "13.7", "0.3", "1")}
                    ${this.numberInput("ground-br-max", "BR max", "1", "13.7", "0.3", "13.7")}
                    ${this.select("ground-premium", "Premium", [
                        ["all", "All"],
                        ["premium", "Premium"],
                        ["regular", "Non-premium"]
                    ])}
                    ${this.numberInput("ground-min-battles", "Min battles", "0", "100000", "100", "1000")}
                    <label class="search-label">Vehicle search
                        <input id="ground-search" type="search" placeholder="XM1, Leopard 2, T-80..." autocomplete="off" aria-label="Search vehicles">
                    </label>
                </div>
                <div class="search-memory">
                    <div><strong>Recent</strong><span id="recent-searches"></span></div>
                    <div><strong>Favourites</strong><span id="favorite-vehicles"></span></div>
                </div>
            </details>
            <div class="ground-rb-results-wrap">
                <table class="ground-rb-results" aria-label="Ground RB vehicle results">
                    <thead>
                        <tr>
                            <th>Vehicle</th><th>Nation</th><th>BR</th><th>Win</th><th>Battles</th><th>G/K</th><th>G/D</th><th>Premium</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="ground-results"></tbody>
                </table>
            </div>
            <div class="ground-panels">
                <article id="vehicle-detail" class="vehicle-detail" aria-live="polite"></article>
                <article id="vehicle-compare" class="vehicle-compare"></article>
            </div>
            <aside class="source-card">
                <h3>Data, Source, And License</h3>
                <p>Fork source: <a href="${this.sourceInfo.forkRepo}">zeoce/wt-data-project.web</a>. Upstream web: <a href="${this.sourceInfo.upstreamWebRepo}">ControlNet/wt-data-project.web</a>. Upstream data: <a href="${this.sourceInfo.upstreamDataRepo}">ControlNet/wt-data-project.data</a>.</p>
                <p>This AGPL project keeps source availability and upstream attribution visible. Thunderskill-derived data is sample-based, and joined vehicle matching may contain errors. Treat low-sample rows as directional, not definitive.</p>
                <p>Prepared: ${this.formatDate(this.sourceInfo.generatedAt)}. Latest data date: ${latest ? this.escape(latest.date) : "N/A"}.</p>
            </aside>
        `;
        this.bindEvents();
        this.renderMemory();
        this.updateResults();
        this.renderCompare();
    }

    private bindEvents(): void {
        ["ground-nation", "ground-br-min", "ground-br-max", "ground-premium", "ground-min-battles", "ground-search"]
            .forEach(id => this.byId(id).addEventListener("input", () => this.updateResults()));

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

    private updateResults(sort: "win" | "played" | "frags" = "win"): void {
        const filters = this.filters();
        let results = this.rows
            .filter(row => filters.nation === "all" || row.nation === filters.nation)
            .filter(row => this.toNumber(row.rb_br) >= filters.brMin && this.toNumber(row.rb_br) <= filters.brMax)
            .filter(row => filters.premium === "all" || (filters.premium === "premium") === this.isPremium(row))
            .filter(row => this.toNumber(row.rb_battles) >= filters.minBattles)
            .filter(row => this.matchesQuery(row, filters.query));

        results = results.sort((a, b) => {
            if (sort === "played") return this.toNumber(b.rb_battles) - this.toNumber(a.rb_battles);
            if (sort === "frags") return this.toNumber(b.rb_ground_frags_per_battle) - this.toNumber(a.rb_ground_frags_per_battle);
            return this.toNumber(b.rb_win_rate) - this.toNumber(a.rb_win_rate);
        }).slice(0, 30);

        const tbody = this.byId("ground-results");
        tbody.innerHTML = results.map(row => this.resultRow(row, filters.minBattles)).join("");
        Array.prototype.forEach.call(tbody.querySelectorAll("[data-select]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.selectVehicle(button.getAttribute("data-select")));
        });
        Array.prototype.forEach.call(tbody.querySelectorAll("[data-compare]"), (button: HTMLButtonElement) => {
            button.addEventListener("click", () => this.toggleCompare(button.getAttribute("data-compare")));
        });
    }

    private resultRow(row: JoinedRow, minBattles: number): string {
        const battles = this.toNumber(row.rb_battles);
        const low = battles < minBattles * 2 ? " low-sample" : "";
        const compared = this.compareNames.indexOf(row.name) >= 0;
        return `
            <tr class="${low}">
                <td><button type="button" data-select="${this.escape(row.name)}">${this.displayName(row)}</button></td>
                <td>${this.escape(row.nation)}</td>
                <td>${this.formatValue(row.rb_br)}</td>
                <td>${this.formatValue(row.rb_win_rate)}%</td>
                <td>${this.formatValue(row.rb_battles)}</td>
                <td>${this.formatValue(row.rb_ground_frags_per_battle)}</td>
                <td>${this.formatValue(row.rb_ground_frags_per_death)}</td>
                <td>${this.isPremium(row) ? "Yes" : "No"}</td>
                <td><button type="button" data-compare="${this.escape(row.name)}">${compared ? "Remove" : "Compare"}</button></td>
            </tr>
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

    private renderDetail(row: JoinedRow): void {
        const favorites = this.favorites.indexOf(row.name) >= 0;
        const lowSample = this.toNumber(row.rb_battles) < this.filters().minBattles;
        this.byId("vehicle-detail").innerHTML = `
            <h3>${this.displayName(row)}</h3>
            <div class="detail-actions">
                <button type="button" id="favorite-current">${favorites ? "Unfavorite" : "Favourite"}</button>
                <button type="button" id="compare-current">Add To Comparison</button>
            </div>
            <dl>
                <dt>Nation</dt><dd>${this.escape(row.nation)}</dd>
                <dt>Class</dt><dd>${this.escape(row.cls)}</dd>
                <dt>AB / RB / SB BR</dt><dd>${this.formatValue(row.ab_br)} / ${this.formatValue(row.rb_br)} / ${this.formatValue(row.sb_br)}</dd>
                <dt>RB win rate</dt><dd>${this.formatValue(row.rb_win_rate)}%</dd>
                <dt>RB battles</dt><dd>${this.formatValue(row.rb_battles)}</dd>
                <dt>RB ground frags/battle</dt><dd>${this.formatValue(row.rb_ground_frags_per_battle)}</dd>
                <dt>RB ground frags/death</dt><dd>${this.formatValue(row.rb_ground_frags_per_death)}</dd>
                <dt>RB repair</dt><dd>${this.formatValue(row.rb_repair)}</dd>
                <dt>Premium</dt><dd>${this.isPremium(row) ? "Yes" : "No"}</dd>
                <dt>Source update</dt><dd>${this.sourceInfo ? this.escape(this.sourceInfo.latestJoined.date) : "N/A"}</dd>
            </dl>
            <p class="data-caveat">${lowSample ? "Low sample warning: this row is below the selected battle threshold. " : ""}Thunderskill data is sample-based and joined data can contain vehicle matching errors.</p>
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
            container.innerHTML = "<h3>Comparison</h3><p>Select 2 to 4 vehicles to compare.</p>";
            return;
        }
        container.innerHTML = `
            <h3>Comparison</h3>
            <div class="ground-rb-results-wrap">
                <table class="compare-table">
                    <thead><tr><th>Vehicle</th><th>BR</th><th>Win</th><th>Battles</th><th>G/K</th><th>G/D</th><th>Repair</th><th>Premium</th></tr></thead>
                    <tbody>${rows.map(row => `
                        <tr><td>${this.displayName(row)}</td><td>${this.formatValue(row.rb_br)}</td><td>${this.formatValue(row.rb_win_rate)}%</td><td>${this.formatValue(row.rb_battles)}</td><td>${this.formatValue(row.rb_ground_frags_per_battle)}</td><td>${this.formatValue(row.rb_ground_frags_per_death)}</td><td>${this.formatValue(row.rb_repair)}</td><td>${this.isPremium(row) ? "Yes" : "No"}</td></tr>
                    `).join("")}</tbody>
                </table>
            </div>
            <button type="button" id="copy-comparison">Copy comparison summary</button>
        `;
        this.byId("copy-comparison").addEventListener("click", () => this.copyComparison());
    }

    private copyComparison(): void {
        const rows = this.compareNames
            .map(name => this.rows.filter(row => row.name === name)[0])
            .filter(row => row);
        const text = rows.map(row =>
            `${this.displayName(row)}: BR ${this.formatValue(row.rb_br)}, ${this.formatValue(row.rb_win_rate)}% WR, ${this.formatValue(row.rb_battles)} battles, ${this.formatValue(row.rb_ground_frags_per_battle)} G/K, ${this.formatValue(row.rb_ground_frags_per_death)} G/D`
        ).join("\n");
        navigator.clipboard?.writeText(text);
    }

    private applyPreset(preset: string): void {
        (this.byId("ground-nation") as HTMLSelectElement).value = "all";
        (this.byId("ground-br-min") as HTMLInputElement).value = "1";
        (this.byId("ground-br-max") as HTMLInputElement).value = "13.7";
        (this.byId("ground-premium") as HTMLSelectElement).value = preset === "premium" ? "premium" : "all";
        (this.byId("ground-min-battles") as HTMLInputElement).value = preset === "sample" ? "2000" : "1000";
        (this.byId("ground-search") as HTMLInputElement).value = "";
        this.updateResults(preset === "played" ? "played" : preset === "frags" ? "frags" : "win");
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
        if (recent) recent.innerHTML = this.recentSearches.slice(0, 5).map(text => `<button type="button" data-memory="${this.escape(text)}">${this.escape(text)}</button>`).join("");
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

    private readList(key: string): string[] {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    private nationOptions(): Array<[string, string]> {
        const nations = this.metadata ? ["all", "USA", "Germany", "USSR", "Britain", "Japan", "France", "Italy", "China", "Sweden", "Israel"] : ["all"];
        return nations.map(nation => [nation, nation === "all" ? "All nations" : nation]);
    }

    private button(id: string, text: string): string {
        return `<button type="button" id="${id}">${text}</button>`;
    }

    private select(id: string, label: string, options: Array<[string, string]>): string {
        return `<label>${label}<select id="${id}" aria-label="${label}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></label>`;
    }

    private numberInput(id: string, label: string, min: string, max: string, step: string, value: string): string {
        return `<label>${label}<input id="${id}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    }

    private byId(id: string): HTMLElement {
        return this.root.querySelector(`#${id}`) as HTMLElement;
    }

    private displayName(row: JoinedRow): string {
        return this.escape((row.alt_name || row.wk_name || row.name).replace(/_/g, " "));
    }

    private isPremium(row: JoinedRow): boolean {
        return String(row.is_premium).toLowerCase() === "true";
    }

    private toNumber(value: string): number {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }

    private formatValue(value: string): string {
        return value === "" || value === undefined || value === null ? "N/A" : this.escape(String(value));
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

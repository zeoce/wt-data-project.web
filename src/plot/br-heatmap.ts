import * as d3 from "d3";
import * as _ from "lodash";
import { Plot } from "./plot";
import { TimeseriesData, TimeseriesRow, TimeseriesRowGetter } from "../data/timeseries-data";
import { categoricalColors, COLORS, Container, Inject, MousePosition, Provider, utils } from "../utils";
import { ColorBar } from "./color-bar";
import { BrLineChart, BrLineChartDataObj } from "./line-chart";
import { BrHeatmapLegend } from "./legend";
import { BrHeatmapTooltip, Tooltip } from "./tooltip";
import { Config, Localization, Margin, MeasurementTranslator, NationTranslator } from "../app/config";
import { brs, Content, nations } from "../app/global-env";
import { DATA_BASE } from "../config";
import { BRHeatMapPage } from "../app/page/br-heatmap-page";
import { Nation } from "../data/wiki-data";
import { BrHeatColorMap } from "../misc/color-map-def";

const MIN_USABLE_HEATMAP_CELLS = 40;
const HEATMAP_EMPTY_COLOR = "#2A322E";
const HEATMAP_CELL_STROKE = "rgba(255,255,255,0.22)";

@Provider(BrHeatmap)
export class BrHeatmap extends Plot {
    @Inject(Config.BrHeatmapPage.BrHeatmap.svgHeight) readonly svgHeight: number;
    @Inject(Config.BrHeatmapPage.BrHeatmap.svgWidth) readonly svgWidth: number;
    @Inject(Config.BrHeatmapPage.BrHeatmap.margin) readonly margin: Margin;
    @Inject(Config.BrHeatmapPage.BrHeatmap.mainSvgId) readonly mainSvgId: string;
    @Inject(ColorBar) readonly colorBar: ColorBar;
    @Inject(BrLineChart) readonly lineChart: BrLineChart;
    @Inject(BrHeatmapLegend) readonly legend: BrHeatmapLegend;
    @Inject(BrHeatmapTooltip) readonly tooltip: Tooltip;
    @Inject(Content) readonly content: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>
    @Inject(BRHeatMapPage) readonly page: BRHeatMapPage;
    colorMaps: BrHeatColorMap | null = null;
    private frozenAxisSvg!: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
    private frozenAxisG!: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
    private focusedBr: string | null = null;

    selected: Array<SquareInfo> = [];

    onPointerLeave(_: SquareInfo, node: SVGRectElement): void {
        d3.select(node).classed("is-hovered", false);
        this.tooltip.hide();
    }

    onPointerOver(d: SquareInfo, node: SVGRectElement): void {
        if (d.value <= 0) return;
        d3.select(node).classed("is-hovered", true);
        this.tooltip.appear();
        this.tooltip.rect
            .transition()
            .duration(100)
            .style("fill", this.value2color(d.value));
    }

    async onPointerMove(d: SquareInfo, node: SVGRectElement): Promise<void> {
        if (d.value <= 0) return;
        await this.tooltip.update([
            `${Container.get(Localization.BrHeatmapPage.Tooltip.nation)}${Container.get<NationTranslator>(Localization.Nation)(d.nation)}`,
            `${Container.get(Localization.BrHeatmapPage.Tooltip.br)}${d.br}`,
            `${Container.get<MeasurementTranslator>(Localization.Measurement)(this.page.measurement)}: ${_.round(d.value, 3)}`
        ], new MousePosition(
            d3.mouse(node)[0],
            d3.mouse(node)[1]
        ));
    }

    async onClick(_: SquareInfo, node: SVGRectElement): Promise<void> {
        const square: d3.Selection<SVGRectElement, SquareInfo, HTMLElement, any> = d3.select(node);
        const info: SquareInfo = square.data()[0];
        if (info.value <= 0) return;

        if (square.classed("is-selected")) {
            // if the square is selected
            square.classed("is-selected", false);
            // remove the item in the `this.selected`
            this.selected = this.selected.filter(each => each.br !== info.br || each.nation !== info.nation);
        } else {
            // if the square is not selected
            square.classed("is-selected", true);
            // add the item into the `this.selected`
            this.selected.push(info);
        }
    }

    cache: TimeseriesData;
    value2color: Value2Color;

    colorPool = {
        values: utils.deepCopy(categoricalColors),
        i: 0,

        bindings: new Array<{ br: string, nation: string, color: string }>(),

        get: function(d: BrLineChartDataObj) {
            // if the category is generated before, use previous color
            for (const binding of this.bindings) {
                if (binding.br === d.br && binding.nation === d.nation) {
                    return binding.color;
                }
            }
            // else assign a new color to the nation
            const out = this.values[this.i];
            this.i++;
            if (this.i === this.values.length) {
                this.i = 0;
            }

            // add to binding
            this.bindings.push({
                nation: d.nation,
                br: d.br,
                color: out
            })
            return out;
        },
    }

    init(): BrHeatmap {
        // build new plot in the content div of page
        const heatmapPair = this.content
            .append<HTMLDivElement>("div")
            .attr("id", "heatmap-scroll-pair")
            .attr("class", "heatmap-scroll-pair")
            .style("--heatmap-frozen-axis-width", `${this.margin.left}px`);

        this.frozenAxisSvg = heatmapPair
            .append<SVGSVGElement>("svg")
            .attr("height", this.svgHeight)
            .attr("width", this.margin.left)
            .attr("id", "frozen-br-axis-svg")
            .attr("aria-hidden", "true");

        this.frozenAxisG = this.frozenAxisSvg
            .append<SVGGElement>("g")
            .attr("id", "frozen-br-axis-g")
            .attr("class", "heatmap-axis heatmap-axis-y")
            .attr("transform", `translate(${this.margin.left - 5}, ${this.margin.top})`);

        this.svg = heatmapPair
            .append<SVGSVGElement>("svg")
            .attr("height", this.svgHeight)
            .attr("width", this.svgWidth)
            .attr("id", this.mainSvgId);

        // init the heatmap plot body
        this.g = this.svg.append<SVGGElement>("g")
            .attr("id", "main-g")
            .attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);

        d3.csv(this.dataPath, async (data: TimeseriesData) => {
            // init
            const dataObjs = this.extractData(data);
            this.buildAxis();

            // Init the colour scale and cell tooltip.
            this.colorBar.init();
            this.tooltip.init();

            // colorMap function
            this.value2color = await this.getValue2color();
            this.drawSquares(dataObjs, false);

            this.cache = data;

            // sort the tooltip in the top layer
            this.tooltip.toTopLayer();
        })
        return this;
    }

    async update(reDownload: boolean): Promise<BrHeatmap> {
        const oldAxis = d3.selectAll("g#br-heatmap-x, g#br-heatmap-y");
        oldAxis.remove();
        this.buildAxis();

        if (reDownload) {
            // if need re-download data
            await new Promise<void>(resolve => d3.csv(this.dataPath, async (data: TimeseriesData) => {
                await this.updateSquares(data);
                this.cache = data;
                resolve();
            }));
        } else {
            // else read data from cache
            await this.updateSquares(this.cache);
        }

        // reset selected data and sub plots
        this.selected = [];
        this.focusedBr = null;
        this.applyBrFocus();
        // sort the tooltip in the top layer
        this.tooltip.toTopLayer();

        return this;
    }

    private async updateSquares(data: TimeseriesData) {
        // init
        const dataObjs = this.extractData(data);

        // colorMap function
        this.value2color = await this.getValue2color();

        this.drawSquares(dataObjs, true);
    }

    private drawSquares(dataObjs: Array<SquareInfo>, transition: boolean): void {
        const {x, y} = this.scales();
        const squareWidth = this.width / nations.length;
        const squareHeight = this.height / brs[this.page.brRange].length;

        const rects = this.g
            .selectAll<SVGRectElement, SquareInfo>("rect")
            .data(dataObjs, d => d.nation + d.br);

        const entered = rects.enter()
            .append<SVGRectElement>("rect")
            .attr("rx", 3)
            .attr("ry", 3)
            .style("stroke-width", 1)
            .style("stroke", HEATMAP_CELL_STROKE)
            .on("pointerover", utils.eventWrapper<SVGRectElement, typeof this.onPointerOver>(this, this.onPointerOver))
            .on("pointerleave", utils.eventWrapper<SVGRectElement, typeof this.onPointerLeave>(this, this.onPointerLeave))
            .on("pointermove", utils.eventWrapper<SVGRectElement, typeof this.onPointerMove>(this, this.onPointerMove))
            .on("click", utils.eventWrapper<SVGRectElement, typeof this.onClick>(this, this.onClick));

        rects.exit()
            .remove();

        const merged = entered.merge(rects)
            .attr("x", d => x(d.nation))
            .attr("y", d => y(d.br))
            .attr("width", squareWidth)
            .attr("height", squareHeight)
            .classed("is-empty-cell", d => d.value <= 0)
            .classed("is-selected", d => this.selected.some(each => each.br === d.br && each.nation === d.nation))
            .style("stroke-width", 1)
            .style("stroke", HEATMAP_CELL_STROKE)
            .style("cursor", d => d.value > 0 ? "pointer" : "default");

        this.applyBrFocus();

        if (transition) {
            merged.transition()
                .style("fill", d => this.value2color(d.value));
        } else {
            merged
                .style("fill", d => this.value2color(d.value));
        }
    }

    private scales() {
        const x = d3.scaleBand()
            .range([0, this.width])
            .domain(nations);

        const y = d3.scaleBand()
            .range([this.height, 0])
            .domain(brs[this.page.brRange]);

        return {x, y};
    }

    private buildAxis() {
        const {x, y} = this.scales();

        // x-axis
        this.g.append("g")
            .attr("id", "br-heatmap-x")
            .attr("class", "heatmap-axis heatmap-axis-x")
            .style("font-size", 13)
            .attr("transform", `translate(0, ${this.height + 10})`)
            .call(d3.axisBottom(x).tickSize(0)
                .tickFormat(Container.get<NationTranslator>(Localization.Nation)))
            .select("#main-g g path.domain").remove()

        // y-axis
        const yAxis = this.g.append("g")
            .attr("id", "br-heatmap-y")
            .attr("class", "heatmap-axis heatmap-axis-y")
            .style("font-size", 14)
            .attr("transform", `translate(-5, 0)`)
            .call(d3.axisLeft(y).tickSize(0))
        yAxis.select("path.domain").remove();

        this.frozenAxisG
            .selectAll("*")
            .remove();
        this.frozenAxisG
            .style("font-size", 14)
            .call(d3.axisLeft(y).tickSize(0))
            .select("path.domain")
            .remove();
        this.bindBrAxisInteractions(yAxis);
        this.bindBrAxisInteractions(this.frozenAxisG);
        return {x, y};
    }

    private bindBrAxisInteractions(axis: d3.Selection<SVGGElement, unknown, HTMLElement, any>): void {
        axis.selectAll<SVGGElement, string>(".tick")
            .attr("role", "button")
            .attr("tabindex", 0)
            .attr("aria-label", br => `Focus BR ${br} row`)
            .attr("aria-pressed", br => String(this.focusedBr === br))
            .classed("is-br-focused", br => this.focusedBr === br)
            .on("click.br-focus", br => this.toggleBrFocus(br))
            .on("keydown.br-focus", br => {
                if (d3.event.key !== "Enter" && d3.event.key !== " ") return;
                d3.event.preventDefault();
                this.toggleBrFocus(br);
            });
    }

    private toggleBrFocus(br: string): void {
        this.focusedBr = this.focusedBr === br ? null : br;
        this.applyBrFocus();
    }

    private applyBrFocus(): void {
        if (!this.g) return;

        this.g.selectAll<SVGRectElement, SquareInfo>("rect")
            .classed("is-br-dimmed", d => this.focusedBr !== null && d.br !== this.focusedBr)
            .classed("is-br-focused", d => this.focusedBr === d.br);

        [this.g.select<SVGGElement>("#br-heatmap-y"), this.frozenAxisG]
            .forEach(axis => {
                if (!axis || axis.empty()) return;
                axis.selectAll<SVGGElement, string>(".tick")
                    .attr("aria-pressed", br => String(this.focusedBr === br))
                    .classed("is-br-focused", br => this.focusedBr === br)
                    .classed("is-br-dimmed", br => this.focusedBr !== null && br !== this.focusedBr);
            });
    }

    private extractData(data: Array<TimeseriesRow>): Array<SquareInfo> {
        const {rows, usedFallback, requestedDate, fallbackDate} = this.rowsForUsableDate(data);
        const dataObjs = rows
            .map(row => {
                const get = new TimeseriesRowGetter(row, this.page.mode, this.page.measurement);
                return {
                    nation: row.nation,
                    br: this.brLabel(get),
                    lowerBr: get.lowerBr,
                    value: get.value
                }
            })
            .filter(row => brs[this.page.brRange].indexOf(row.br) >= 0);

        this.renderDataStatus(dataObjs, usedFallback, requestedDate, fallbackDate);

        const blankObjs: Array<SquareInfo> = [];
        nations.forEach(nation => {
            brs[this.page.brRange].forEach(br => {
                if (!dataObjs.find(obj => obj.nation === nation && obj.br === br)) {
                    blankObjs.push({
                        nation,
                        br,
                        value: 0,
                        lowerBr: +br.split("~")[0].replace(" ", ""),
                    })
                }
            })
        })

        return dataObjs.concat(blankObjs);
    }

    private brLabel(get: TimeseriesRowGetter): string {
        return this.page.brRange === "0" ? get.lowerBr.toFixed(1) : get.br;
    }

    private rowsForUsableDate(data: Array<TimeseriesRow>): {
        rows: Array<TimeseriesRow>;
        usedFallback: boolean;
        requestedDate: string;
        fallbackDate: string;
    } {
        const requestedDate = this.page.date;
        const requestedRows = this.rowsForDate(data, requestedDate);
        if (this.usableCellCount(requestedRows) >= MIN_USABLE_HEATMAP_CELLS) {
            return {rows: requestedRows, usedFallback: false, requestedDate, fallbackDate: requestedDate};
        }

        const fallbackDate = this.latestUsableDate(data);
        if (fallbackDate && fallbackDate !== requestedDate) {
            const select = document.getElementById("date-selection") as HTMLSelectElement;
            if (select) {
                select.value = fallbackDate;
                localStorage.setItem("date-selection", fallbackDate);
            }
            console.warn(`No complete heatmap data for ${requestedDate}; showing ${fallbackDate} instead.`);
            return {
                rows: this.rowsForDate(data, fallbackDate),
                usedFallback: true,
                requestedDate,
                fallbackDate
            };
        }

        console.warn(`Heatmap data for ${requestedDate} has ${this.usableCellCount(requestedRows)} usable cells.`);
        return {rows: requestedRows, usedFallback: false, requestedDate, fallbackDate: requestedDate};
    }

    private rowsForDate(data: Array<TimeseriesRow>, date: string): Array<TimeseriesRow> {
        return data.filter(row => row.date === date && row.cls === this.page.clazz);
    }

    private latestUsableDate(data: Array<TimeseriesRow>): string | null {
        const dates = Array.from(new Set(data
            .filter(row => row.cls === this.page.clazz)
            .map(row => row.date)))
            .sort()
            .reverse();
        return dates.find(date => this.usableCellCount(this.rowsForDate(data, date)) >= MIN_USABLE_HEATMAP_CELLS) || null;
    }

    private usableCellCount(rows: Array<TimeseriesRow>): number {
        return rows
            .map(row => new TimeseriesRowGetter(row, this.page.mode, this.page.measurement))
            .filter(get => brs[this.page.brRange].indexOf(this.brLabel(get)) >= 0 && get.value > 0)
            .length;
    }

    private renderDataStatus(dataObjs: Array<SquareInfo>, usedFallback: boolean, requestedDate: string, fallbackDate: string): void {
        const status = document.getElementById("heatmap-data-status");
        const usable = dataObjs.filter(row => row.value > 0).length;
        if (usable < MIN_USABLE_HEATMAP_CELLS) {
            console.warn(`Heatmap rendered with ${usable} coloured cells for ${this.page.date}/${this.page.clazz}/${this.page.mode}/${this.page.brRange}.`);
        }
        if (!status) return;
        if (usedFallback) {
            status.hidden = false;
            status.textContent = `No complete heatmap data is available for ${requestedDate}. Showing latest available date instead: ${fallbackDate}.`;
        } else if (usable < MIN_USABLE_HEATMAP_CELLS) {
            status.hidden = false;
            status.textContent = `Heatmap data for ${this.page.date} has fewer than ${MIN_USABLE_HEATMAP_CELLS} coloured cells for this filter combination.`;
        } else {
            status.hidden = true;
            status.textContent = "";
        }
    }

    private async getValue2color(): Promise<Value2Color> {
        this.colorMaps = Container.get(BrHeatColorMap)
        let value2range: d3.ScaleLinear<number, number>;
        let range2color: d3.ScaleLinear<string, string>;
        let valueMin: number;
        let valueMax: number;

        switch (this.page.measurement) {
            case "win_rate":
                valueMin = 0;
                valueMax = 100;

                value2range = d3.scaleLinear<number, number>()
                    .domain([valueMin, valueMax])
                    .range([0, 1]);

                if (this.page.clazz === "Ground_vehicles") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.winRate.Ground_vehicles.percentiles)
                        .range(this.colorMaps.winRate.Ground_vehicles.colors)
                        .interpolate(d3.interpolateRgb)
                } else if (this.page.clazz === "Aviation") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.winRate.Aviation.percentiles)
                        .range(this.colorMaps.winRate.Aviation.colors)
                        .interpolate(d3.interpolateRgb)
                } else {
                    throw new Error(`Invalid clazz ${this.page.clazz} for colorMap win_rate`);
                }
                break;
            case "battles_sum":
                valueMin = Math.pow(10, 2.5);
                valueMax = Math.pow(10, 5.5);

                value2range = d3.scaleLog()
                    .domain([valueMin, valueMax])
                    .range([0, 1]);

                range2color = d3.scaleLinear<string, string>()
                    .domain(this.colorMaps.battlesSum.Ground_vehicles.percentiles)
                    .range(this.colorMaps.battlesSum.Ground_vehicles.colors)
                    .interpolate(d3.interpolateRgb)
                break;
            case "air_frags_per_battle":
                valueMin = 0;
                valueMax = 10;

                value2range = d3.scaleLinear<number, number>()
                    .domain([valueMin, valueMax])
                    .range([0, 1]);

                if (this.page.clazz === "Ground_vehicles") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.airFragsPerBattle.Ground_vehicles.percentiles)
                        .range(this.colorMaps.airFragsPerBattle.Ground_vehicles.colors)
                        .interpolate(d3.interpolateRgb)
                } else if (this.page.clazz === "Aviation") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.airFragsPerBattle.Aviation.percentiles)
                        .range(this.colorMaps.airFragsPerBattle.Aviation.colors)
                        .interpolate(d3.interpolateRgb)
                } else {
                    throw new Error(`Invalid clazz ${this.page.clazz} for colorMap air_frags_per_battle`);
                }
                break;
            case "air_frags_per_death":
                valueMin = 0;
                valueMax = 10;

                value2range = d3.scaleLinear<number, number>()
                    .domain([valueMin, valueMax])
                    .range([0, 1]);

                if (this.page.clazz === "Ground_vehicles") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.airFragsPerDeath.Ground_vehicles.percentiles)
                        .range(this.colorMaps.airFragsPerDeath.Ground_vehicles.colors)
                        .interpolate(d3.interpolateRgb)
                } else if (this.page.clazz === "Aviation") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.airFragsPerDeath.Aviation.percentiles)
                        .range(this.colorMaps.airFragsPerDeath.Aviation.colors)
                        .interpolate(d3.interpolateRgb)
                } else {
                    throw new Error(`Invalid clazz ${this.page.clazz} for colorMap air_frags_per_death`);
                }
                break;
            case "ground_frags_per_battle":
                valueMin = 0;
                valueMax = 10;

                value2range = d3.scaleLinear<number, number>()
                    .domain([valueMin, valueMax])
                    .range([0, 1]);

                if (this.page.clazz === "Ground_vehicles") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.groundFragsPerBattle.Ground_vehicles.percentiles)
                        .range(this.colorMaps.groundFragsPerBattle.Ground_vehicles.colors)
                        .interpolate(d3.interpolateRgb)
                } else if (this.page.clazz === "Aviation") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.groundFragsPerBattle.Aviation.percentiles)
                        .range(this.colorMaps.groundFragsPerBattle.Aviation.colors)
                        .interpolate(d3.interpolateRgb)
                } else {
                    throw new Error(`Invalid clazz ${this.page.clazz} for colorMap ground_frags_per_battle`);
                }
                break;
            case "ground_frags_per_death":
                valueMin = 0;
                valueMax = 10;

                value2range = d3.scaleLinear<number, number>()
                    .domain([valueMin, valueMax])
                    .range([0, 1]);

                if (this.page.clazz === "Ground_vehicles") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.groundFragsPerDeath.Ground_vehicles.percentiles)
                        .range(this.colorMaps.groundFragsPerDeath.Ground_vehicles.colors)
                        .interpolate(d3.interpolateRgb)
                } else if (this.page.clazz === "Aviation") {
                    range2color = d3.scaleLinear<string, string>()
                        .domain(this.colorMaps.groundFragsPerDeath.Aviation.percentiles)
                        .range(this.colorMaps.groundFragsPerDeath.Aviation.colors)
                        .interpolate(d3.interpolateRgb)
                } else {
                    throw new Error(`Invalid clazz ${this.page.clazz} for colorMap ground_frags_per_death`);
                }
                break;
            default:
                throw new Error("Invalid measurement for colorMap " + this.page.measurement);
        }

        const value2color = (value: number) => range2color(value2range(value));

        // update color bar
        await this.colorBar.update(valueMin, valueMax, value2color);

        return (value: number) => {
            if (value == 0.) {
                return HEATMAP_EMPTY_COLOR;
            } else {
                return range2color(value2range(value));
            }
        }
    }

    get dataPath(): string {
        return `${DATA_BASE}/${this.page.mode.toLowerCase()}_ranks_${this.page.brRange}.csv`
    }
}

export interface SquareInfo {
    nation: Nation;
    br: string;
    lowerBr: number;
    value: number;
}

export interface Value2Color {
    (value: number): number | string | COLORS
}

import { Page, PageClass } from "./page/page";
import { Metadata } from "../data/metadata";
import * as d3 from "d3";
import { Link, LinkClass } from "./link/link";
import { Config, Localization } from "./config";
import { Container, WasmUtils } from "../utils";
import "reflect-metadata";
import "../plot/br-heatmap";
import "../plot/color-bar";
import "../plot/line-chart";
import "../plot/legend";
import "../plot/table";
import "../plot/tooltip";
import { GlobalEnv } from "./global-env";
import "./sidebar/sidebar-element";
import "./sidebar/select";
import { Logo, LogoClass } from "./image/logo";

export class Application {
    static Logo: LogoClass;
    static logo: Logo;
    static Pages: Array<PageClass<any>>;
    static pages: Array<Page>;
    static metadata: Array<Metadata>;
    static dates: Array<string>;
    static Links: Array<LinkClass<any>>;
    static links: Array<Link>;

    static run(): void {
        Application.renderDataStatus("Loading /data/metadata.json...");

        fetch("data/metadata.json")
            .then(response => {
                if (!response.ok) {
                    throw new Error(`data/metadata.json returned HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(async (metadata: Array<Metadata>) => {
                if (!metadata || !metadata.length) {
                    Application.renderDataStatus("The local metadata file loaded, but it did not include any entries.", true);
                    return;
                }

                // load wasm module
                await WasmUtils.init();

                // init Container constants
                Container.importProvider();
                await Config.load();
                await Localization.load();
                GlobalEnv.init();

                Application.metadata = metadata;

                // initialize the dates
                Application.dates = Application.metadata
                    .filter(each => each.type === "joined")
                    .map(each => each.date)
                    .reverse();

                // initialize the logo
                Application.logo = Container.get(Application.Logo);
                Application.logo.init();

                // initialize the pages
                Application.pages = Application.Pages.map(Container.get);
                Application.pages.forEach(page => page.init());

                // initialize the links
                Application.links = Application.Links.map(Container.get);
                Application.links.forEach(link => link.init());

                // render the first page
                Application.pages[0].update();
            })
            .catch(error => {
                Application.renderDataStatus(
                    `Required metadata failed to load: ${error instanceof Error ? error.message : "unknown error"}. Check that /data/metadata.json exists in the deployed dist folder.`,
                    true
                );
            });
    }

    static renderDataStatus(message: string, error = false): void {
        d3.select("#content")
            .html("")
            .append("section")
            .attr("class", error ? "data-status is-error" : "data-status")
            .attr("role", "status")
            .attr("aria-live", "polite")
            .html(`<strong>Data status</strong><span>${message}</span><small>Required file: /data/metadata.json</small>`);
    }

    static build = {
        withBlank() {
            return Application.build;
        },

        withLogo(Logo: LogoClass) {
            Application.Logo = Logo;
            return Application.build;
        },

        withPages(...Pages: Array<PageClass<Page>>) {
            Application.Pages = Pages;
            return Application.build;
        },

        withLinks(...Links: Array<LinkClass<Link>>) {
            Application.Links = Links;
            return Application.build;
        },

        class: Application
    };
}

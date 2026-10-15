"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;
const workbuddy_ui_js = __importDefault(require("./ui/workbuddy/index.ui.js"));

const WORKBUDDY_ROUTE = "toolpkg:com.operit.dsh_connect_workbuddy:ui:workbuddy_home";

function registerToolPkg() {
    ToolPkg.registerUiRoute({
        id: "workbuddy_home",
        route: WORKBUDDY_ROUTE,
        runtime: "compose_dsl",
        screen: workbuddy_ui_js.default,
        params: {},
        keepAlive: true,
        title: {
            zh: "WorkBuddy 接入",
            en: "WorkBuddy Connect",
        },
    });

    ToolPkg.registerNavigationEntry({
        id: "workbuddy_sidebar_entry",
        route: WORKBUDDY_ROUTE,
        surface: "main_sidebar_plugins",
        title: {
            zh: "WorkBuddy",
            en: "WorkBuddy",
        },
        icon: "computer",
        order: 200,
    });

    return true;
}
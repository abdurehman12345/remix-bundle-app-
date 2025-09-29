"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/@shopify/shopify_function/index.ts
var userFunction = __toESM(require("user-function"));

// ../../node_modules/@shopify/shopify_function/run.ts
function run_default(userfunction) {
  try {
    ShopifyFunction;
  } catch (e) {
    throw new Error(
      "ShopifyFunction is not defined. Please rebuild your function using the latest version of Shopify CLI."
    );
  }
  const input_obj = ShopifyFunction.readInput();
  const output_obj = userfunction(input_obj);
  ShopifyFunction.writeOutput(output_obj);
}

// ../../node_modules/@shopify/shopify_function/index.ts
run_default(userFunction?.default);

// src/run.js
function getAttribute(attrs, key) {
  if (!Array.isArray(attrs))
    return null;
  const found = attrs.find((a) => a && a.key === key);
  return found && typeof found.value === "string" ? found.value : null;
}
(void 0)((input) => {
  const attrs = input && input.cart && input.cart.attributes || [];
  const centsStr = getAttribute(attrs, "additional_charges_cents") || "0";
  const cents = parseInt(centsStr, 10) || 0;
  if (cents <= 0) {
    return { operations: [] };
  }
  const wrapName = getAttribute(attrs, "gift_wrap_name") || "";
  const cardName = getAttribute(attrs, "gift_card_name") || "";
  const details = [wrapName, cardName].filter(Boolean).join(" + ");
  const titleBase = "Gift services";
  const title = details ? `${titleBase} (${details})` : titleBase;
  const currency = input && input.cart && input.cart.cost && input.cart.cost.totalAmount && input.cart.cost.totalAmount.currencyCode || input && input.shop && input.shop.currencyCode || "USD";
  const amount = (cents / 100).toFixed(2);
  return {
    operations: [
      {
        addLineItem: {
          title,
          price: {
            amount,
            currencyCode: currency
          },
          metadata: [
            { key: "source", value: "bundle-app" },
            { key: "wrap", value: wrapName || "" },
            { key: "card", value: cardName || "" },
            { key: "cents", value: String(cents) }
          ]
        }
      }
    ]
  };
});

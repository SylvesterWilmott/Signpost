"use strict";

import strings from "../strings.json" assert { type: "json" };

document.addEventListener("DOMContentLoaded", init);

let label;

function init() {
  label = document.getElementById("label");

  registerListeners();
  loadStrings();
}

function loadStrings() {
  const elements = document.querySelectorAll("[data-string]");

  for (const el of elements) {
    const stringKey = el.dataset.string;
    const stringValue = strings[stringKey];
    el.innerText = stringValue;
  }
}

function registerListeners() {
  window.electronAPI.onWindowSizeRequested(sendSizeToMain)
}

function sendSizeToMain() {
  const width = label.offsetWidth;
  window.electronAPI.send('updatePopoverWidth', width);
}

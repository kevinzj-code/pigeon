/* patch-options.js — a skill pack's prompts and tunables, as factory options.
 *
 * A sealed Patch carries his prompts as data (prompts/<role>.json) and his
 * measured numbers as tunables.json. The code that turns them into requests
 * stays in this checkout; this file is only the mapping from the packed field
 * names to the option names the factories take. It used to live in the Node
 * loader (scripts/lib/pigeon-load.mjs); it is here so the webview can make the
 * same mapping out of the same pack without importing Node-only tooling.
 *
 * Pure: no DOM, no node: imports, no I/O.
 */

import { trainedSystemFor } from './category-router.js';

/**
 * `{ prompts, tunables }` (as packed) → the options each factory is handed.
 * `routerOptions.promptedSystem` fills `{menu}` with split/join, so a menu
 * holding `$&` is inserted literally rather than read as a replacement pattern.
 */
export function optionsFrom ({ prompts, tunables }) {
  /* From version 6 a pack carries no prompts (D84): they are its Pigeons',
     packed from these same constants, so every factory keeps its default. */
  if (!prompts || !Object.keys(prompts).length) {
    return {
      plannerOptions: {}, declineOptions: {}, asksOptions: {}, siblingOptions: {}, focusOptions: {},
      routerOptions: { lexicalOptions: lexicalFrom(tunables) },
      turnOptions: tunables.turn?.fallback_on_empty !== undefined ? { fallbackOnEmpty: tunables.turn.fallback_on_empty } : {}
    };
  }
  const template = prompts.category.prompted_system_template;
  return {
    plannerOptions: { system: prompts.planner.system, shots: prompts.planner.shots, runwayRule: prompts.planner.runway_rule },
    routerOptions: {
      trainedSystem: prompts.category.trained_system,
      promptedSystem: (menu) => template.split('{menu}').join(menu),
      shots: prompts.category.shots,
      lexicalOptions: lexicalFrom(tunables)
    },
    /* What runTurn takes from the pack; a version 1 pack has none of it. */
    turnOptions: tunables.turn?.fallback_on_empty !== undefined ? { fallbackOnEmpty: tunables.turn.fallback_on_empty } : {},
    declineOptions: { system: prompts.decline.system, shots: prompts.decline.shots },
    asksOptions: { system: prompts.asks.system, userTurnTemplate: prompts.asks.user_turn_template, shots: prompts.asks.shots },
    siblingOptions: { system: prompts.sibling.system, systemTrained: prompts.sibling.system_trained, shots: prompts.sibling.shots },
    focusOptions: { system: prompts.focus.system, shots: prompts.focus.shots }
  };
}

function lexicalFrom (tunables) {
  return { threshold: tunables.router.threshold, marginFloor: tunables.router.margin_floor, k: tunables.router.k,
           /* Absent from a version 1 pack: the constant applies. */
           ...(tunables.router.number_weight !== undefined ? { numberWeight: tunables.router.number_weight } : {}) };
}

/**
 * The one prompt that is a function of the skills: the category line the
 * adapter was trained on. The pack must say exactly what this app would build
 * from the pack's own skills (categories collected as categoryRouter collects
 * them), or its router is being asked a question it never learnt. Throws.
 */
export function checkTrainedSystem (registry, prompts) {
  /* A version 6 pack has no prompts: its router Pigeon's prompt_check holds
     the category line instead, and the engine proves it at load. */
  if (!prompts || !Object.keys(prompts).length) return;
  const byCategory = {};
  for (const s of registry.routable()) (byCategory[s.category] ??= []).push(s.name);
  const categories = Object.keys(byCategory).sort();
  if (prompts?.category?.trained_system !== trainedSystemFor(categories)) {
    throw new Error("prompts/category.json's trained_system is not what these skills' categories build");
  }
}

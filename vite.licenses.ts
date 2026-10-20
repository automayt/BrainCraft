/**
 * Credit where it's due, and no legal surprises: every open-source package the builds actually put
 * into dist/ (what the bundles contain, not what package.json lists) is recorded with its licence,
 * and dist/THIRD_PARTY_NOTICES.txt carries their copyright notices and licence texts, as their
 * licences ask. The app's Credits screen reads dist/credits.json.
 *
 * A build stops if something ships under a licence not on the list below, so a new dependency
 * gets a look before it goes out.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

/** Licences that let BrainCraft use, change and pass the code on (keeping the notices). */
export const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'OFL-1.1', 'CC0-1.0', 'Unlicense', 'Zlib', 'BlueOak-1.0.0', 'Python-2.0', 'MIT-0'])

export interface Credit {
  name: string
  version: string
  license: string
  /** Who holds the copyright, when the package says. */
  author?: string
  homepage?: string
  /** The licence text the package ships (LICENSE, NOTICE…), or the standard text for its licence. */
  text?: string
}

/**
 * Copyright lines for packages that ship no licence file, checked against their projects
 * (github.com/excalidraw/excalidraw and github.com/radix-ui/primitives, LICENSE).
 */
const KNOWN_COPYRIGHT: [RegExp, string][] = [
  [/^@excalidraw\/excalidraw$/, 'Copyright (c) 2020 Excalidraw'],
  [/^@radix-ui\//, 'Copyright (c) 2022 WorkOS'],
]

/** The standard licence texts, from packages that ship them (so they're word for word). */
const standardText = (() => {
  const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  const mit = read('node_modules/react/LICENSE').replace(/^[\s\S]*?Permission is hereby granted/, 'Permission is hereby granted')
  const ofl = read('node_modules/@fontsource-variable/inter/LICENSE').replace(/^[\s\S]*?This Font Software is licensed/, 'This Font Software is licensed')
  return { MIT: mit.trim(), 'OFL-1.1': ofl.trim() } as Record<string, string>
})()

/** A licence written out for a package or font that doesn't ship one: its copyright, then the standard text. */
function composed(license: string, copyright: string): string | undefined {
  const body = standardText[license]
  return body ? `${copyright}\n\n${body}\n\n(BrainCraft wrote this notice out: the package ships no licence file of its own.)` : undefined
}

/**
 * Fonts copied beside the app for Excalidraw drawings (not modules, so listed by hand). Copyright
 * lines are the ones inside the font files; licences as the files and their projects state them.
 * Liberation Sans and Cascadia, which come with Excalidraw too, aren't shipped: their files'
 * licence wording is unclear, and drawings only use them for old text styles.
 */
export const SHIPPED_FONTS = ['Excalifont', 'Virgil', 'Nunito', 'ComicShanns', 'Assistant', 'Lilita', 'Xiaolai']

const FONT_SOURCE = 'from @excalidraw/excalidraw'
export const EXTRA_CREDITS: Credit[] = [
  { name: 'Excalifont (font)', version: FONT_SOURCE, license: 'OFL-1.1', author: 'Excalidraw', homepage: 'https://plus.excalidraw.com/excalifont', text: 'Copyright (c) 2024 by Excalidraw.' },
  { name: 'Virgil (font)', version: FONT_SOURCE, license: 'OFL-1.1', author: 'Your Own Font Foundry', homepage: 'https://plus.excalidraw.com/virgil', text: 'Copyright (c) 2011 by Your Own Font Foundry.' },
  { name: 'Nunito (font)', version: FONT_SOURCE, license: 'OFL-1.1', homepage: 'https://github.com/googlefonts/nunito', text: 'Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)' },
  {
    name: 'Assistant (font)',
    version: FONT_SOURCE,
    license: 'OFL-1.1',
    homepage: 'https://github.com/hafontia/Assistant',
    text: "Copyright 2020 The Assistant Project Authors (https://github.com/hafontia/Assistant). Copyright 2010 The Source Sans Pro Authors (https://github.com/adobe-fonts/source-sans-pro), with Reserved Font Name 'Source'. Source is a trademark of Adobe Systems Incorporated in the United States and/or other countries.",
  },
  { name: 'Lilita One (font)', version: FONT_SOURCE, license: 'OFL-1.1', author: 'Juan Montoreano', text: 'Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz), with Reserved Font Names "Lilita One"' },
  { name: 'Xiaolai SC (font)', version: FONT_SOURCE, license: 'OFL-1.1', author: 'LXGW', homepage: 'https://github.com/lxgw/kose-font', text: 'Copyright © 2020 LXGW' },
  {
    name: 'Comic Shanns (font)',
    version: FONT_SOURCE,
    license: 'MIT',
    homepage: 'https://github.com/shannpersand/comic-shanns',
    text: 'Copyright (c) 2018 Shannon Miwa\nCopyright (c) 2023 Jesus Gonzalez\nCopyright (c) 2023 Rodrigo Batista de Moraes\nCopyright (c) 2024 Fini Jastrow\nCopyright (c) 2024 Kyle Beechly',
  },
].map((c) => ({ ...c, text: `${c.text}\n\n${standardText[c.license] ?? ''}`.trim() }))

const ROOT = resolve('.')

/** The package a module file belongs to (its folder with a named package.json), outside this project. */
function packageDir(file: string): string | null {
  const clean = file.replace(/^\0/, '').split('?')[0]
  const at = clean.lastIndexOf(`node_modules${sep}`) >= 0 ? clean.lastIndexOf(`node_modules${sep}`) : clean.lastIndexOf('node_modules/')
  if (at < 0) return null
  const rest = clean.slice(at + 'node_modules/'.length).split(/[\\/]/)
  let dir = clean.slice(0, at + 'node_modules/'.length) + (rest[0].startsWith('@') ? `${rest[0]}${sep}${rest[1]}` : rest[0])
  dir = resolve(dir)
  return existsSync(join(dir, 'package.json')) ? dir : null
}

const licenceOf = (pkg: Record<string, unknown>): string => {
  const l = pkg.license ?? pkg.licenses
  if (typeof l === 'string') return l
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : (x as { type?: string }).type)).join(' OR ')
  if (l && typeof l === 'object') return String((l as { type?: unknown }).type ?? 'UNKNOWN')
  return 'UNKNOWN'
}

/** Whether a licence expression is fine: every part of an AND, at least one part of an OR. */
export function allowed(expr: string): boolean {
  const e = expr.replace(/[()]/g, '').trim()
  if (/ OR /i.test(e)) return e.split(/ OR /i).some((p) => allowed(p))
  if (/ AND /i.test(e)) return e.split(/ AND /i).every((p) => allowed(p))
  return ALLOWED.has(e)
}

/** The licence a licence file holds, from its standard wording. */
function sniff(text: string): string | null {
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(text)) return 'ISC'
  if (/Apache License,?\s+Version 2\.0/i.test(text)) return 'Apache-2.0'
  if (/SIL OPEN FONT LICENSE Version 1\.1/i.test(text)) return 'OFL-1.1'
  if (/Redistribution and use in source and binary forms/i.test(text)) return /Neither the name/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause'
  return null
}

function creditOf(dir: string): Credit {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort()
  const text = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n') || undefined
  const author = typeof pkg.author === 'string' ? pkg.author : (pkg.author as { name?: string } | undefined)?.name
  const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository as { url?: string } | undefined)?.url
  const homepage = (typeof pkg.homepage === 'string' ? pkg.homepage : repo)?.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
  // A package that doesn't say in package.json: its licence file does.
  const declared = licenceOf(pkg)
  const license = declared === 'UNKNOWN' && text ? (sniff(text) ?? declared) : declared
  const name = String(pkg.name)
  const copyright = KNOWN_COPYRIGHT.find(([re]) => re.test(name))?.[1] ?? `Copyright (c) ${author ?? `the ${name} authors`}`
  const finalText = text ?? composed(license, copyright)
  return { name, version: String(pkg.version ?? ''), license, ...(author ? { author } : {}), ...(homepage ? { homepage } : {}), ...(finalText ? { text: finalText } : {}) }
}

/** The notices file: a list, then each package's copyright and licence text. */
export function noticesText(credits: Credit[]): string {
  const head = `BrainCraft is built with these open-source projects. Thank you to everyone who made them.\nEach is used under its own licence, given in full below.\n\n${credits.map((c) => `- ${c.name} ${c.version} (${c.license})${c.homepage ? ` ${c.homepage}` : ''}`).join('\n')}\n`
  const body = credits.map((c) => `${'='.repeat(78)}\n${c.name} ${c.version}\nLicence: ${c.license}${c.author ? `\nBy: ${c.author}` : ''}${c.homepage ? `\nHome: ${c.homepage}` : ''}\n\n${c.text ?? `(This package ships no licence file; its package.json says ${c.license}.)`}\n`)
  return `${head}\n${body.join('\n')}`
}

/**
 * Records what each build bundles and writes the notices into its output folder. The three builds
 * (app, MCP server, BrainCraft server) share dist/, so each adds to what the others recorded.
 */
export function licenses(extra: Credit[] = []): Plugin {
  const dirs = new Set<string>()
  return {
    name: 'braincraft-licenses',
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        const ids = out.type === 'chunk' ? [...Object.keys(out.modules), ...(out.moduleIds ?? [])] : (out.originalFileNames ?? [])
        for (const id of ids) {
          const dir = packageDir(id)
          if (dir && !dir.startsWith(join(ROOT, 'src')) && dir !== ROOT) dirs.add(dir)
        }
      }
    },
    writeBundle(options) {
      const outDir = options.dir ?? dirname(options.file ?? 'dist/x')
      const file = join(outDir, 'credits.json')
      const known: Credit[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Credit[]) : []
      const byName = new Map(known.map((c) => [`${c.name}@${c.version}`, c]))
      for (const c of [...[...dirs].map(creditOf), ...extra]) byName.set(`${c.name}@${c.version}`, c)
      const credits = [...byName.values()].sort((a, z) => a.name.localeCompare(z.name))
      const bad = credits.filter((c) => !allowed(c.license))
      if (bad.length) throw new Error(`These would ship under licences not yet looked at (vite.licenses.ts ALLOWED):\n${bad.map((c) => `  ${c.name} ${c.version}: ${c.license}`).join('\n')}`)
      writeFileSync(file, JSON.stringify(credits, null, 1))
      writeFileSync(join(outDir, 'THIRD_PARTY_NOTICES.txt'), noticesText(credits))
    },
  }
}

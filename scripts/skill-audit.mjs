#!/usr/bin/env node
/**
 * Fail when a skill carries project content.
 *
 * A skill is a capability: it may name the document it expects a project to
 * keep (`specs/INDEX.md`), but it must not carry that document's facts — a
 * table name, an endpoint, a host, a business scenario. Facts baked into a
 * capability follow it into every project that mounts it, and the one place
 * they are wrong becomes invisible.
 *
 *   node scripts/skill-audit.mjs <dir> [<dir>...]
 *
 * @module dsh-fullstack-team/scripts/skill-audit
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PATTERNS = [
  ['项目/公司名', /\b(?:shuangrui|科贸|领先未来)\b|双蕊/iu],
  ['业务仓名', /\b(?:mall|merchant|platform)-manage[\w-]*/iu],
  ['主机或连接串', /jdbc:|mysql:\/\/|redis:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\brds\.[\w.-]+/iu],
  ['接口路径', /\/api\/[\w/-]{4,}/iu],
  ['业务表名', /\b(?:biz|sys|t)_[a-z_]{4,}/iu],
  ['口令或手机号', /\badmin\d+\b|\b1[3-9]\d{9}\b|password\s*[:=]\s*\S+/iu],
  ['本机绝对路径', /[A-Z]:\/Coding|\/Users\/[a-z]+\//u],
]

/** Collect every text file under a directory. */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.(?:md|ya?ml|txt)$/u.test(entry)) yield path
  }
}

const roots = process.argv.slice(2)
if (roots.length === 0) {
  console.error('用法：node scripts/skill-audit.mjs <dir> [<dir>...]')
  process.exit(2)
}

let findings = 0
for (const root of roots) {
  for (const path of walk(root)) {
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      // A link to someone else's documentation is not a project fact: strip
      // URLs before looking for hosts and endpoints, or every external
      // reference reads as a violation.
      const scanned = line.replace(/https?:\/\/\S+/gu, '<url>')
      for (const [label, pattern] of PATTERNS) {
        if (!pattern.test(scanned)) continue
        findings += 1
        console.log(`${path}:${index + 1}  [${label}]  ${line.trim().slice(0, 90)}`)
      }
    })
  }
}

if (findings === 0) console.log('技能体检通过：没有项目内容混进能力文件')
else console.log(`\n共 ${findings} 处需要分离：把事实移进项目仓的 specs/，技能里只留索引指针`)
process.exit(findings === 0 ? 0 : 1)

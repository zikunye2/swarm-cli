/**
 * Splash screen with cute bee ASCII art
 */

// ANSI color helpers
const c = {
  yellow: (s: string) => `\x1b[93m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[96m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  white: (s: string) => `\x1b[97m${s}\x1b[0m`,
  bgYellow: (s: string) => `\x1b[43m\x1b[30m${s}\x1b[0m`,
  bgBlack: (s: string) => `\x1b[40m\x1b[93m${s}\x1b[0m`,
};

export function printSplash(version: string): void {
  const bee = [
    ``,
    `      ${c.yellow('✦')}  ${c.dim('·')}  ${c.yellow('✦')}`,
    `       ${c.white('\\  /')}`,
    `     ${c.white('⊂( •ᴗ• )⊃')}   ${c.dim('∿∿∿')}`,
    `       ${c.bgYellow('░')}${c.bgBlack('▓')}${c.bgYellow('░')}`,
    `       ${c.bgBlack('▓')}${c.bgYellow('░')}${c.bgBlack('▓')}`,
    `        ${c.yellow('╲ ╱')}`,
    `      ${c.bold(c.cyan('s w a r m'))}`,
    ``,
    `    ${c.dim(`Multi-Agent Deliberation CLI v${version}`)}`,
    ``,
  ];

  console.log(bee.join('\n'));
}

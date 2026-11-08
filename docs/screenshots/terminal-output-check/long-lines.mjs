// Prints 80 numbered lines of 130 characters and exits: plain output, no redraw of
// any kind. Used to see whether a resize alone (the terminal's reflow and ConPTY's
// repaint, with no program redrawing) leaves any line twice in the scrollback.
for (let i = 1; i <= 80; i++) {
  const head = `L${String(i).padStart(2, '0')} `;
  process.stdout.write(head + 'x'.repeat(130 - head.length - 4) + ` L${String(i).padStart(2, '0')}` + '\n');
}

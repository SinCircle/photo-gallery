export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: Array<Node | string | undefined | null> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  if (props.className) node.className = props.className
  for (const child of children) {
    if (child == null) continue
    node.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return node
}

export function clear(node: HTMLElement) {
  node.replaceChildren()
}

export function onceOutsideClick(params: {
  root: HTMLElement
  onOutside: () => void
}) {
  const onPointerDown = (event: PointerEvent) => {
    if (!params.root.contains(event.target as Node)) params.onOutside()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') params.onOutside()
  }

  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeyDown)

  return () => {
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('keydown', onKeyDown)
  }
}

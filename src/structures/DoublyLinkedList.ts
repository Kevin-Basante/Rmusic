import { Node } from './Node';

/**
 * Doubly linked list.
 * The first node is called the "head" and the last node is called the "tail".
 * Every node knows its previous and next node, so the list can be
 * traversed in both directions.
 */
export class DoublyLinkedList<T> {
  head: Node<T> | null;
  tail: Node<T> | null;
  length: number;

  constructor() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  /** Adds a value to the end of the list. O(1) */
  append(value: T): Node<T> {
    const newNode = new Node(value);
    if (this.head === null) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      newNode.prev = this.tail;
      this.tail!.next = newNode;
      this.tail = newNode;
    }
    this.length++;
    return newNode;
  }

  /** Adds a value to the start of the list. O(1) */
  prepend(value: T): Node<T> {
    const newNode = new Node(value);
    if (this.head === null) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      newNode.next = this.head;
      this.head.prev = newNode;
      this.head = newNode;
    }
    this.length++;
    return newNode;
  }

  /**
   * Returns the node at the given index.
   * Because the list is doubly linked, it starts from the head when the
   * index is in the first half, and from the tail when it is in the second half.
   */
  traverseToIndex(index: number): Node<T> {
    this.checkIndex(index, this.length - 1);

    if (index < this.length / 2) {
      let currentNode = this.head!;
      let i = 0;
      while (i !== index) {
        currentNode = currentNode.next!;
        i++;
      }
      return currentNode;
    }

    let currentNode = this.tail!;
    let i = this.length - 1;
    while (i !== index) {
      currentNode = currentNode.prev!;
      i--;
    }
    return currentNode;
  }

  /** Inserts a value at the given index (0 = start, length = end). */
  insert(index: number, value: T): Node<T> {
    this.checkIndex(index, this.length);

    if (index === 0) return this.prepend(value);
    if (index === this.length) return this.append(value);

    const newNode = new Node(value);
    const leader = this.traverseToIndex(index - 1);
    const follower = leader.next!;

    leader.next = newNode;
    newNode.prev = leader;
    newNode.next = follower;
    follower.prev = newNode;

    this.length++;
    return newNode;
  }

  /** Removes the node at the given index and returns its value. */
  remove(index: number): T {
    this.checkIndex(index, this.length - 1);
    return this.removeNode(this.traverseToIndex(index));
  }

  /**
   * Unlinks a node that belongs to this list. O(1), because the node
   * already knows its previous and next neighbours.
   */
  removeNode(node: Node<T>): T {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;

    node.next = null;
    node.prev = null;
    this.length--;
    return node.value;
  }

  /** Moves the value at index "from" to index "to". Returns the new node. */
  move(from: number, to: number): Node<T> {
    this.checkIndex(from, this.length - 1);
    this.checkIndex(to, this.length - 1);
    const value = this.remove(from);
    return this.insert(to, value);
  }

  /** Returns the index of a node, or -1 if it is not in the list. */
  indexOfNode(node: Node<T>): number {
    let currentNode = this.head;
    let i = 0;
    while (currentNode !== null) {
      if (currentNode === node) return i;
      currentNode = currentNode.next;
      i++;
    }
    return -1;
  }

  /** Returns the first node whose value matches the predicate. */
  find(predicate: (value: T) => boolean): Node<T> | null {
    let currentNode = this.head;
    while (currentNode !== null) {
      if (predicate(currentNode.value)) return currentNode;
      currentNode = currentNode.next;
    }
    return null;
  }

  /** Removes every node. */
  clear(): void {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  /** Values from head to tail. */
  toArray(): T[] {
    const values: T[] = [];
    let currentNode = this.head;
    while (currentNode !== null) {
      values.push(currentNode.value);
      currentNode = currentNode.next;
    }
    return values;
  }

  /** Values from tail to head (walking through the "prev" pointers). */
  toArrayReverse(): T[] {
    const values: T[] = [];
    let currentNode = this.tail;
    while (currentNode !== null) {
      values.push(currentNode.value);
      currentNode = currentNode.prev;
    }
    return values;
  }

  /** Text representation, e.g. "null <- A <-> B <-> C -> null". */
  printList(format: (value: T) => string = String): string {
    if (this.head === null) return 'null';
    return `null <- ${this.toArray().map(format).join(' <-> ')} -> null`;
  }

  *[Symbol.iterator](): Iterator<T> {
    let currentNode = this.head;
    while (currentNode !== null) {
      yield currentNode.value;
      currentNode = currentNode.next;
    }
  }

  private checkIndex(index: number, max: number): void {
    if (!Number.isInteger(index) || index < 0 || index > max) {
      throw new RangeError(`Index ${index} is out of range (0 - ${max}).`);
    }
  }
}

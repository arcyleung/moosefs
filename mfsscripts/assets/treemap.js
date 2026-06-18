/*
Copyright (C) 2025 Jakub Kruszona-Zawadzki, Saglabs SA

This file is part of MooseFS.

MooseFS is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, version 2 (only).

MooseFS is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with MooseFS; if not, write to the Free Software
Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA 02111-1301, USA
or visit http://www.gnu.org/licenses/gpl-2.0.html
*/

/**
 * TreemapRenderer - Interactive SVG-based treemap visualization for MooseFS
 * Implements squarified treemap algorithm with configurable color schemes
 */
class TreemapRenderer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container element with id '${containerId}' not found`);
        }

        // Default configuration
        this.config = {
            width: options.width || this.container.clientWidth,
            height: options.height || 400,
            padding: options.padding || 2,
            strokeWidth: options.strokeWidth || 1,
            minLabelSize: options.minLabelSize || 20,
            colorScheme: options.colorScheme || 'type',
            includeFiles: options.includeFiles !== false,
            maxDepth: options.maxDepth || 3,
            animationDuration: options.animationDuration || 300,
            ...options
        };

        // Internal state
        this.data = null;
        this.currentPath = '/';
        this.selectedNode = null;
        this.hoveredNode = null;
        this.svg = null;
        this.tooltip = null;
        this.isLoading = false;

        // Initialize the treemap
        this.init();
    }

    /**
     * Initialize the treemap visualization
     */
    init() {
        this.createSVG();
        this.createTooltip();
        this.bindEvents();
        this.updateDimensions();
    }

    /**
     * Create SVG element for treemap rendering
     */
    createSVG() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'treemap-svg');
        this.svg.setAttribute('viewBox', `0 0 ${this.config.width} ${this.config.height}`);
        this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // Create main group for treemap nodes
        this.mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.mainGroup.setAttribute('class', 'treemap-main-group');
        this.svg.appendChild(this.mainGroup);

        this.container.appendChild(this.svg);
    }

    /**
     * Create tooltip element
     */
    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.setAttribute('class', 'treemap-tooltip');
        document.body.appendChild(this.tooltip);
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Window resize
        window.addEventListener('resize', () => this.updateDimensions());

        // Container hover events
        this.container.addEventListener('mouseenter', () => this.onContainerEnter());
        this.container.addEventListener('mouseleave', () => this.onContainerLeave());

        // SVG events
        this.svg.addEventListener('click', (e) => this.onSVGClick(e));
        this.svg.addEventListener('mousemove', (e) => this.onSVGMouseMove(e));
    }

    /**
     * Update SVG dimensions based on container size
     */
    updateDimensions() {
        const rect = this.container.getBoundingClientRect();
        this.config.width = rect.width;
        this.config.height = Math.max(400, rect.height);

        this.svg.setAttribute('viewBox', `0 0 ${this.config.width} ${this.config.height}`);

        if (this.data) {
            this.render();
        }
    }

    /**
     * Set treemap data and render
     */
    setData(data) {
        this.data = this.processData(data);
        this.render();
    }

    /**
     * Process and validate treemap data
     */
    processData(data) {
        if (!data || !data.children || data.children.length === 0) {
            throw new Error('Invalid treemap data: must have children array');
        }

        // Calculate total size for percentage calculations
        const totalSize = this.calculateTotalSize(data);

        // Process each node
        const processNode = (node, depth = 0) => {
            const processed = {
                name: node.name || 'Unknown',
                path: node.path || '/',
                size: node.size || 0,
                type: node.type || 'unknown',
                mtime: node.mtime || Date.now(),
                children: [],
                depth: depth,
                percentage: (node.size / totalSize) * 100
            };

            if (node.children && node.children.length > 0 && depth < this.config.maxDepth) {
                processed.children = node.children
                    .filter(child => this.config.includeFiles || child.type === 'directory')
                    .map(child => processNode(child, depth + 1))
                    .filter(child => child.size > 0); // Filter out empty nodes
            }

            return processed;
        };

        return processNode(data);
    }

    /**
     * Calculate total size of all nodes
     */
    calculateTotalSize(node) {
        if (!node.children || node.children.length === 0) {
            return node.size || 0;
        }

        return node.children.reduce((total, child) => {
            return total + this.calculateTotalSize(child);
        }, 0);
    }

    /**
     * Render the treemap
     */
    render() {
        if (!this.data) return;

        // Clear existing content
        this.mainGroup.innerHTML = '';

        // Calculate layout using squarified treemap algorithm
        const layout = this.calculateLayout(this.data, 0, 0, this.config.width, this.config.height);

        // Render nodes
        this.renderNodes(layout);

        // Update breadcrumb
        this.updateBreadcrumb();
    }

    /**
     * Calculate treemap layout using squarified algorithm
     */
    calculateLayout(node, x, y, width, height) {
        if (width <= 0 || height <= 0) return [];

        const nodes = [];

        if (!node.children || node.children.length === 0) {
            // Leaf node
            nodes.push({
                node: node,
                x: x,
                y: y,
                width: width,
                height: height,
                color: this.getNodeColor(node)
            });
        } else {
            // Parent node - calculate layout for children
            const children = node.children.sort((a, b) => b.size - a.size);
            const layout = this.squarify(children, x, y, width, height);
            nodes.push(...layout);
        }

        return nodes;
    }

    /**
     * Squarified treemap algorithm implementation
     * Improved to use multiple rows/strips for better aspect ratios when sibling sizes vary greatly.
     * This avoids long skinny strips across the full dimension.
     */
    squarify(nodes, x, y, width, height) {
        if (nodes.length === 0) return [];

        const layout = [];
        const totalSize = nodes.reduce((sum, node) => sum + node.size, 0);

        if (totalSize === 0) return [];

        // Greedy row-based squarify to keep rectangles closer to square
        let i = 0;
        while (i < nodes.length) {
            const row = [];
            let rowTotal = 0;
            let bestWorst = Infinity;
            let j = i;

            // Build a row: add nodes while it improves (or doesn't worsen) the worst aspect
            for (; j < nodes.length; j++) {
                const candidate = nodes[j];
                const candidateSize = candidate.size;
                const testRow = row.concat([candidate]);
                const testTotal = rowTotal + candidateSize;

                const testAspect = this._worstAspect(testRow, testTotal, width, height);

                if (testAspect <= bestWorst || row.length === 0) {
                    row.push(candidate);
                    rowTotal = testTotal;
                    bestWorst = testAspect;
                } else {
                    break;
                }
            }

            if (row.length === 0) {
                // fallback, shouldn't happen
                row.push(nodes[i]);
                rowTotal = nodes[i].size;
                j = i + 1;
            }

            // Layout this row as a strip
            const rowLayout = this._layoutRow(row, rowTotal, x, y, width, height);
            layout.push(...rowLayout);

            // Advance
            i = j;

            // Update remaining space for next row (we consume the strip)
            // For simplicity, we always consume full in one direction per row; subsequent rows use remaining.
            // To keep simple and fill space: we treat subsequent as new "container" but adjust y/x.
            if (width >= height) {
                // horizontal rows: consume height
                const rowHeight = rowLayout.length > 0 ? rowLayout[0].height : height / (nodes.length - i + 1);
                y += rowHeight;
                height -= rowHeight;
            } else {
                const rowWidth = rowLayout.length > 0 ? rowLayout[0].width : width / (nodes.length - i + 1);
                x += rowWidth;
                width -= rowWidth;
            }
        }

        return layout;
    }

    /**
     * Compute worst aspect ratio for a candidate row (used for greedy choice)
     */
    _worstAspect(row, rowTotal, containerWidth, containerHeight) {
        if (rowTotal === 0) return Infinity;
        const isHorizontal = containerWidth >= containerHeight;
        let worst = 0;
        for (let node of row) {
            const p = node.size / rowTotal;
            let w, h;
            if (isHorizontal) {
                w = containerWidth * p;
                h = containerHeight;
            } else {
                w = containerWidth;
                h = containerHeight * p;
            }
            const ar = Math.max(w / h, h / w);
            if (ar > worst) worst = ar;
        }
        return worst;
    }

    /**
     * Layout a row of nodes as a single strip (horizontal or vertical)
     * Returns array of positioned leaf (or sub-layout) items with x,y,w,h,color
     */
    _layoutRow(row, rowTotal, x, y, containerWidth, containerHeight) {
        if (row.length === 0 || rowTotal === 0) return [];

        const layout = [];
        const isHorizontal = containerWidth >= containerHeight;

        let currentX = x;
        let currentY = y;
        let remW = containerWidth;
        let remH = containerHeight;

        for (let node of row) {
            const p = node.size / rowTotal;
            let nodeW, nodeH;

            if (isHorizontal) {
                nodeW = containerWidth * p;
                nodeH = containerHeight;
            } else {
                nodeW = containerWidth;
                nodeH = containerHeight * p;
            }

            const padX = currentX + this.config.padding;
            const padY = currentY + this.config.padding;
            const padW = Math.max(0, nodeW - 2 * this.config.padding);
            const padH = Math.max(0, nodeH - 2 * this.config.padding);

            if (padW > 0 && padH > 0) {
                if (node.children && node.children.length > 0) {
                    const sub = this.calculateLayout(node, padX, padY, padW, padH);
                    layout.push(...sub);
                } else {
                    layout.push({
                        node: node,
                        x: padX,
                        y: padY,
                        width: padW,
                        height: padH,
                        color: this.getNodeColor(node)
                    });
                }
            }

            if (isHorizontal) {
                currentX += nodeW;
                remW -= nodeW;
            } else {
                currentY += nodeH;
                remH -= nodeH;
            }
        }

        return layout;
    }

    /**
     * Get color for a node based on current color scheme
     */
    getNodeColor(node) {
        const style = getComputedStyle(document.documentElement);

        switch (this.config.colorScheme) {
            case 'type':
                return this.getColorByType(node.type, style);
            case 'age':
                return this.getColorByAge(node.mtime, style);
            case 'size':
                return this.getColorBySize(node.size, style);
            default:
                return style.getPropertyValue('--treemap-color-unknown');
        }
    }

    /**
     * Get color by file type
     */
    getColorByType(type, style) {
        const typeColors = {
            'directory': '--treemap-color-directory',
            'image': '--treemap-color-image',
            'video': '--treemap-color-video',
            'audio': '--treemap-color-audio',
            'document': '--treemap-color-document',
            'archive': '--treemap-color-archive',
            'code': '--treemap-color-code',
            'text': '--treemap-color-text',
            'spreadsheet': '--treemap-color-spreadsheet',
            'presentation': '--treemap-color-presentation',
            'pdf': '--treemap-color-pdf',
            'executable': '--treemap-color-executable',
            'library': '--treemap-color-library',
            'config': '--treemap-color-config',
            'temp': '--treemap-color-temp',
            'system': '--treemap-color-system'
        };

        const cssVar = typeColors[type.toLowerCase()] || '--treemap-color-other';
        return style.getPropertyValue(cssVar).trim();
    }

    /**
     * Get color by file age
     */
    getColorByAge(mtime, style) {
        const now = Date.now();
        const age = now - mtime;
        const dayMs = 24 * 60 * 60 * 1000;

        let cssVar;
        if (age < dayMs) {
            cssVar = '--treemap-age-veryrecent';
        } else if (age < 7 * dayMs) {
            cssVar = '--treemap-age-recent';
        } else if (age < 30 * dayMs) {
            cssVar = '--treemap-age-medium';
        } else if (age < 365 * dayMs) {
            cssVar = '--treemap-age-old';
        } else {
            cssVar = '--treemap-age-veryold';
        }

        return style.getPropertyValue(cssVar).trim();
    }

    /**
     * Get color by file size
     */
    getColorBySize(size, style) {
        const kb = 1024;
        const mb = kb * 1024;
        const gb = mb * 1024;

        let cssVar;
        if (size < kb) {
            cssVar = '--treemap-size-tiny';
        } else if (size < mb) {
            cssVar = '--treemap-size-small';
        } else if (size < gb) {
            cssVar = '--treemap-size-medium';
        } else if (size < 10 * gb) {
            cssVar = '--treemap-size-large';
        } else {
            cssVar = '--treemap-size-huge';
        }

        return style.getPropertyValue(cssVar).trim();
    }

    /**
     * Render treemap nodes as SVG elements
     */
    renderNodes(layout) {
        layout.forEach(item => {
            const rect = this.createRect(item);
            const text = this.createText(item);

            this.mainGroup.appendChild(rect);
            if (text) {
                this.mainGroup.appendChild(text);
            }
        });
    }

    /**
     * Create SVG rectangle for a treemap node
     */
    createRect(item) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'treemap-node');
        rect.setAttribute('x', item.x);
        rect.setAttribute('y', item.y);
        rect.setAttribute('width', item.width);
        rect.setAttribute('height', item.height);
        rect.setAttribute('fill', item.color);
        rect.setAttribute('data-node-path', item.node.path);
        rect.setAttribute('data-node-name', item.node.name);
        rect.setAttribute('data-node-size', item.node.size);
        rect.setAttribute('data-node-type', item.node.type);
        rect.setAttribute('data-node-percentage', item.node.percentage.toFixed(2));

        // Add hover effects
        rect.addEventListener('mouseenter', (e) => this.onNodeHover(e, item.node));
        rect.addEventListener('mouseleave', () => this.onNodeLeave());

        return rect;
    }

    /**
     * Create SVG text label for a treemap node
     */
    createText(item) {
        // Only show text if node is large enough
        if (item.width < this.config.minLabelSize || item.height < this.config.minLabelSize) {
            return null;
        }

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'treemap-label');
        text.setAttribute('x', item.x + item.width / 2);
        text.setAttribute('y', item.y + item.height / 2);

        // Determine text class based on size
        if (item.width < 40 || item.height < 20) {
            text.classList.add('tiny');
        } else if (item.width < 60 || item.height < 30) {
            text.classList.add('small');
        }

        // Create text content
        const displayName = this.truncateText(item.node.name, item.width);
        text.textContent = displayName;

        return text;
    }

    /**
     * Truncate text to fit within specified width
     */
    truncateText(text, maxWidth) {
        const avgCharWidth = 8; // Approximate character width in pixels
        const maxChars = Math.floor(maxWidth / avgCharWidth);

        if (text.length <= maxChars) {
            return text;
        }

        return text.substring(0, Math.max(1, maxChars - 3)) + '...';
    }

    /**
     * Handle node hover
     */
    onNodeHover(event, node) {
        this.hoveredNode = node;
        this.showTooltip(event, node);

        // Highlight the rectangle
        const rect = event.target;
        rect.style.opacity = '0.8';
        rect.style.strokeWidth = '2px';
    }

    /**
     * Handle node leave
     */
    onNodeLeave() {
        this.hoveredNode = null;
        this.hideTooltip();

        // Remove highlight from all rectangles
        this.mainGroup.querySelectorAll('.treemap-node').forEach(rect => {
            rect.style.opacity = '';
            rect.style.strokeWidth = '';
        });
    }

    /**
     * Show tooltip for a node
     */
    showTooltip(event, node) {
        const tooltip = this.tooltip;

        // Format file size
        const sizeStr = this.formatFileSize(node.size);

        // Format modification time
        const mtimeStr = new Date(node.mtime).toLocaleString();

        // Create tooltip content
        tooltip.innerHTML = `
            <div class="treemap-tooltip-title">${node.name}</div>
            <div class="treemap-tooltip-row">
                <span class="treemap-tooltip-label">Size:</span>
                <span class="treemap-tooltip-value">${sizeStr}</span>
            </div>
            <div class="treemap-tooltip-row">
                <span class="treemap-tooltip-label">Type:</span>
                <span class="treemap-tooltip-value">${node.type}</span>
            </div>
            <div class="treemap-tooltip-row">
                <span class="treemap-tooltip-label">Percentage:</span>
                <span class="treemap-tooltip-value">${node.percentage.toFixed(2)}%</span>
            </div>
            <div class="treemap-tooltip-row">
                <span class="treemap-tooltip-label">Modified:</span>
                <span class="treemap-tooltip-value">${mtimeStr}</span>
            </div>
            <div class="treemap-tooltip-row">
                <span class="treemap-tooltip-label">Path:</span>
                <span class="treemap-tooltip-value">${node.path}</span>
            </div>
        `;

        // Position tooltip
        const rect = event.target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        let top = rect.top - tooltipRect.height - 10;

        // Keep tooltip within viewport
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top < 10) {
            top = rect.bottom + 10;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.classList.add('visible');
    }

    /**
     * Hide tooltip
     */
    hideTooltip() {
        this.tooltip.classList.remove('visible');
    }

    /**
     * Handle SVG click
     */
    onSVGClick(event) {
        const rect = event.target;
        if (rect.classList.contains('treemap-node')) {
            const nodePath = rect.getAttribute('data-node-path');
            const nodeType = rect.getAttribute('data-node-type');

            if (nodeType === 'directory') {
                this.navigateToDirectory(nodePath);
            }
        }
    }

    /**
     * Handle SVG mouse move
     */
    onSVGMouseMove(event) {
        // Update tooltip position if hovering over a node
        if (this.hoveredNode) {
            const rect = event.target;
            if (rect.classList.contains('treemap-node')) {
                this.showTooltip(event, this.hoveredNode);
            }
        }
    }

    /**
     * Handle container enter
     */
    onContainerEnter() {
        this.container.style.cursor = 'pointer';
    }

    /**
     * Handle container leave
     */
    onContainerLeave() {
        this.hideTooltip();
        this.onNodeLeave();
    }

    /**
     * Navigate to a directory
     */
    navigateToDirectory(path) {
        this.currentPath = path;

        // Trigger navigation event
        const navigationEvent = new CustomEvent('treemapNavigate', {
            detail: { path: path }
        });
        this.container.dispatchEvent(navigationEvent);
    }

    /**
     * Update breadcrumb navigation
     */
    updateBreadcrumb() {
        const breadcrumb = document.querySelector('.treemap-breadcrumb');
        if (!breadcrumb) return;

        const pathParts = this.currentPath.split('/').filter(part => part);
        let html = '<a href="#" class="treemap-breadcrumb-item" data-path="/">/</a>';

        let currentPath = '';
        pathParts.forEach(part => {
            currentPath += '/' + part;
            html += '<span class="treemap-breadcrumb-separator">›</span>';
            html += `<a href="#" class="treemap-breadcrumb-item" data-path="${currentPath}">${part}</a>`;
        });

        breadcrumb.innerHTML = html;

        // Add click handlers
        breadcrumb.querySelectorAll('.treemap-breadcrumb-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const path = e.target.getAttribute('data-path');
                this.navigateToDirectory(path);
            });
        });
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';

        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };

        if (this.data) {
            this.render();
        }
    }

    /**
     * Show loading state
     */
    showLoading() {
        this.isLoading = true;
        this.container.classList.add('loading');

        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'treemap-loading';
        loadingDiv.innerHTML = `
            <div class="treemap-loading-spinner"></div>
            <div>Loading treemap...</div>
        `;
        this.container.appendChild(loadingDiv);
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        this.isLoading = false;
        this.container.classList.remove('loading');

        const loading = this.container.querySelector('.treemap-loading');
        if (loading) {
            loading.remove();
        }
    }

    /**
     * Show error state
     */
    showError(message) {
        this.hideLoading();

        const errorDiv = document.createElement('div');
        errorDiv.className = 'treemap-error';
        errorDiv.textContent = message;
        this.container.appendChild(errorDiv);
    }

    /**
     * Destroy the treemap
     */
    destroy() {
        if (this.tooltip && this.tooltip.parentNode) {
            this.tooltip.parentNode.removeChild(this.tooltip);
        }

        window.removeEventListener('resize', this.updateDimensions);

        if (this.container && this.svg) {
            this.container.removeChild(this.svg);
        }
    }
}

/**
 * Initialize treemap when DOM is ready
 */
function setupTreemapControls(treemap) {
  const pathInput = document.getElementById('treemap-path');
  if (pathInput) {
    pathInput.addEventListener('change', function() { updateTreemap(); });
  }

  const depthSelect = document.getElementById('treemap-depth');
  if (depthSelect) {
    depthSelect.addEventListener('change', function() { updateTreemap(); });
  }

  const colorSelect = document.getElementById('treemap-color-scheme');
  if (colorSelect) {
    colorSelect.addEventListener('change', function() {
      if (treemap && typeof treemap.updateConfig === 'function') {
        treemap.updateConfig({ colorScheme: this.value });
      }
      if (typeof updateLegend === 'function') updateLegend();
    });
  }

  const includeFilesCheckbox = document.getElementById('treemap-include-files');
  if (includeFilesCheckbox) {
    includeFilesCheckbox.addEventListener('change', function() { updateTreemap(); });
  }

  const refreshButton = document.getElementById('treemap-refresh');
  if (refreshButton) {
    refreshButton.addEventListener('click', function() { updateTreemap(); });
  }
}

function updateTreemap() {
  const pathEl = document.getElementById('treemap-path');
  const depthEl = document.getElementById('treemap-depth');
  const includeEl = document.getElementById('treemap-include-files');

  const path = pathEl ? pathEl.value : '/';
  const depth = depthEl ? parseInt(depthEl.value) : 3;
  const includeFiles = includeEl ? includeEl.checked : true;

  const url = new URL(window.location);
  url.searchParams.set('path', path);
  url.searchParams.set('depth', depth);
  url.searchParams.set('include_files', includeFiles ? '1' : '0');
  window.location.href = url.toString();
}

function onTreemapNavigate(path) {
  const pathEl = document.getElementById('treemap-path');
  if (pathEl) pathEl.value = path;
  updateTreemap();
}

function updateLegend() {
  const colorSchemeEl = document.getElementById('treemap-color-scheme');
  const legend = document.getElementById('treemap-legend');
  if (!colorSchemeEl || !legend) return;

  const colorScheme = colorSchemeEl.value;

  const legends = {
    'type': [
      { color: 'var(--treemap-color-directory)', label: 'Directory' },
      { color: 'var(--treemap-color-image)', label: 'Images' },
      { color: 'var(--treemap-color-video)', label: 'Videos' },
      { color: 'var(--treemap-color-audio)', label: 'Audio' },
      { color: 'var(--treemap-color-document)', label: 'Documents' },
      { color: 'var(--treemap-color-archive)', label: 'Archives' },
      { color: 'var(--treemap-color-code)', label: 'Code' },
      { color: 'var(--treemap-color-other)', label: 'Other' }
    ],
    'age': [
      { color: 'var(--treemap-age-veryrecent)', label: 'Very Recent (< 1 day)' },
      { color: 'var(--treemap-age-recent)', label: 'Recent (1-7 days)' },
      { color: 'var(--treemap-age-medium)', label: 'Medium (1-30 days)' },
      { color: 'var(--treemap-age-old)', label: 'Old (1-12 months)' },
      { color: 'var(--treemap-age-veryold)', label: 'Very Old (> 1 year)' }
    ],
    'size': [
      { color: 'var(--treemap-size-tiny)', label: 'Tiny (< 1 KB)' },
      { color: 'var(--treemap-size-small)', label: 'Small (1 KB - 1 MB)' },
      { color: 'var(--treemap-size-medium)', label: 'Medium (1 MB - 1 GB)' },
      { color: 'var(--treemap-size-large)', label: 'Large (1-10 GB)' },
      { color: 'var(--treemap-size-huge)', label: 'Huge (> 10 GB)' }
    ]
  };

  const legendItems = legends[colorScheme] || [];
  let html = '';
  legendItems.forEach(item => {
    html += `
      <div class="treemap-legend-item">
        <div class="treemap-legend-color" style="background-color: ${item.color}"></div>
        <span>${item.label}</span>
      </div>`;
  });
  legend.innerHTML = html;
}

function initTreemapElement(element) {
  if (!element || element.treemapInstance) return;

  const containerId = element.id || `treemap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  element.id = containerId;

  const options = {
    colorScheme: element.getAttribute('data-color-scheme') || 'type',
    includeFiles: element.getAttribute('data-include-files') !== 'false',
    maxDepth: parseInt(element.getAttribute('data-max-depth')) || 3
  };

  const treemap = new TreemapRenderer(containerId, options);
  element.treemapInstance = treemap;

  // Prefer data embedded in a safe json script tag (works with innerHTML inserts)
  let dataScript = document.getElementById('treemap-initial-data');
  if (dataScript) {
    try {
      const data = JSON.parse(dataScript.textContent || dataScript.innerHTML);
      treemap.setData(data);
      // remove the data script so it doesn't interfere on future inits
      dataScript.parentNode && dataScript.parentNode.removeChild(dataScript);
    } catch (e) {
      console.error('Failed to parse embedded treemap initial data', e);
    }
  } else {
    // legacy data-url support (for full page loads or other use cases)
    const dataUrl = element.getAttribute('data-url');
    if (dataUrl) {
      treemap.showLoading();
      fetch(dataUrl)
        .then(r => r.json())
        .then(d => { treemap.setData(d); treemap.hideLoading(); })
        .catch(err => treemap.showError('Failed to load treemap data: ' + err.message));
    }
  }

  // Wire up the control panel (path, depth, color, include-files, refresh)
  setupTreemapControls(treemap);

  // custom navigation from inside the treemap (breadcrumb / clicks)
  element.addEventListener('treemapNavigate', function(e) {
    if (e && e.detail && e.detail.path) onTreemapNavigate(e.detail.path);
  });

  // initial legend for the current color scheme
  if (typeof updateLegend === 'function') updateLegend();
}

// Run on initial DOM ready (full page load with ?sections=TM)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('[data-treemap]').forEach(initTreemapElement);
});

// Support for sections/tabs that are inserted later via innerHTML (the common pattern in this GUI)
const __treemapObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      if (node.nodeType !== 1) return; // elements only
      if (node.hasAttribute && node.hasAttribute('data-treemap')) {
        initTreemapElement(node);
      }
      if (node.querySelectorAll) {
        node.querySelectorAll('[data-treemap]').forEach(initTreemapElement);
      }
    });
  });
});
__treemapObserver.observe(document.documentElement || document.body, {
  childList: true,
  subtree: true
});

// Export for use in other modules (Node) and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TreemapRenderer;
}
if (typeof window !== 'undefined') {
    window.TreemapRenderer = TreemapRenderer;
}
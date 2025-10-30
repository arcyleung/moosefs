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
     */
    squarify(nodes, x, y, width, height) {
        if (nodes.length === 0) return [];

        const layout = [];
        const totalSize = nodes.reduce((sum, node) => sum + node.size, 0);

        if (totalSize === 0) return [];

        let currentX = x;
        let currentY = y;
        let remainingWidth = width;
        let remainingHeight = height;

        // Determine layout direction (horizontal vs vertical)
        const isHorizontal = width >= height;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const nodeSize = node.size;
            const nodePercentage = nodeSize / totalSize;

            let nodeWidth, nodeHeight;

            if (isHorizontal) {
                nodeWidth = remainingWidth * nodePercentage;
                nodeHeight = remainingHeight;
            } else {
                nodeWidth = remainingWidth;
                nodeHeight = remainingHeight * nodePercentage;
            }

            // Apply padding
            const paddedX = currentX + this.config.padding;
            const paddedY = currentY + this.config.padding;
            const paddedWidth = Math.max(0, nodeWidth - 2 * this.config.padding);
            const paddedHeight = Math.max(0, nodeHeight - 2 * this.config.padding);

            if (paddedWidth > 0 && paddedHeight > 0) {
                // Calculate layout for this node's children
                if (node.children && node.children.length > 0) {
                    const childLayout = this.calculateLayout(
                        node, paddedX, paddedY, paddedWidth, paddedHeight
                    );
                    layout.push(...childLayout);
                } else {
                    // Leaf node
                    layout.push({
                        node: node,
                        x: paddedX,
                        y: paddedY,
                        width: paddedWidth,
                        height: paddedHeight,
                        color: this.getNodeColor(node)
                    });
                }
            }

            // Update position for next node
            if (isHorizontal) {
                currentX += nodeWidth;
                remainingWidth -= nodeWidth;
            } else {
                currentY += nodeHeight;
                remainingHeight -= nodeHeight;
            }

            // Stop if we run out of space
            if (remainingWidth <= 0 || remainingHeight <= 0) break;
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
document.addEventListener('DOMContentLoaded', function() {
    // Auto-initialize treemaps with data-treemap attribute
    const treemapElements = document.querySelectorAll('[data-treemap]');

    treemapElements.forEach(element => {
        const containerId = element.id || `treemap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        element.id = containerId;

        const options = {
            colorScheme: element.getAttribute('data-color-scheme') || 'type',
            includeFiles: element.getAttribute('data-include-files') !== 'false',
            maxDepth: parseInt(element.getAttribute('data-max-depth')) || 3
        };

        // Create treemap instance
        const treemap = new TreemapRenderer(containerId, options);

        // Store instance for later access
        element.treemapInstance = treemap;

        // Load data if provided
        const dataUrl = element.getAttribute('data-url');
        if (dataUrl) {
            treemap.showLoading();
            fetch(dataUrl)
                .then(response => response.json())
                .then(data => {
                    treemap.setData(data);
                    treemap.hideLoading();
                })
                .catch(error => {
                    treemap.showError(`Failed to load treemap data: ${error.message}`);
                });
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TreemapRenderer;
}
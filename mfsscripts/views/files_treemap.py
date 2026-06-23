import json
import time

from common.constants import *
from common.utils import *
from common.utilsgui import *
from common.models import *

def render(dp, fields, vld):
	"""Render the treemap visualization view."""

	# Parse configuration parameters from fields
	config = parse_treemap_config(fields)

	# Get treemap data from data provider
	treemap_data = dp.get_treemap_data(
		path=config.path,
		depth=config.depth,
		color_by=config.color_by
	)

	# Generate HTML output
	out = []
	out.append('<div class="tab_title no_table">')
	out.append('<svg class="icon" height="20px" width="20px"><use xlink:href="#icon-chart"/></svg>')
	out.append('Filesystem Treemap')
	out.append('</div>')

	# Add configuration controls
	out.append(render_treemap_controls(config))

	# Add treemap visualization container
	out.append(render_treemap_container(treemap_data, config))

	# Add statistics panel
	out.append(render_treemap_stats(treemap_data))

	# Add JavaScript initialization
	out.append(render_treemap_script(treemap_data, config))

	return "\n".join(out)

def parse_treemap_config(fields):
	"""Parse treemap configuration from form fields."""
	config = TreemapConfig()

	# Parse path
	if 'path' in fields and fields['path']:
		config.path = fields['path']

	# Parse depth
	if 'depth' in fields and fields['depth']:
		try:
			config.depth = int(fields['depth'])
			config.depth = max(1, min(10, config.depth))  # Clamp between 1-10
		except ValueError:
			config.depth = 3

	# Parse color scheme
	if 'color_by' in fields and fields['color_by']:
		if fields['color_by'] in ['type', 'age', 'size']:
			config.color_by = fields['color_by']

	# Parse include files
	if 'include_files' in fields:
		config.include_files = fields['include_files'] == '1'

	return config

def render_treemap_controls(config):
	"""Render treemap configuration controls."""
	out = []
	out.append('<div class="treemap-controls">')

	# Path input
	out.append('<div class="treemap-control-group">')
	out.append('<label for="treemap-path">Path:</label>')
	out.append('<input type="text" id="treemap-path" class="treemap-path-input" ')
	out.append('value="%s" placeholder="Enter filesystem path">' % html_escape(config.path))
	out.append('</div>')

	# Depth selector
	out.append('<div class="treemap-control-group">')
	out.append('<label for="treemap-depth">Depth:</label>')
	out.append('<select id="treemap-depth" class="treemap-depth-selector">')
	for depth in range(1, 6):  # Limit to 5 levels for better performance
		selected = 'selected' if depth == config.depth else ''
		out.append('<option value="%d" %s>%d</option>' % (depth, selected, depth))
	out.append('</select>')
	out.append('</div>')

	# Color scheme selector
	out.append('<div class="treemap-control-group">')
	out.append('<label for="treemap-color-scheme">Color:</label>')
	out.append('<select id="treemap-color-scheme" class="select-fl">')
	color_options = [
		('type', 'File Type'),
		('age', 'File Age'),
		('size', 'File Size')
	]
	for value, label in color_options:
		selected = 'selected' if value == config.color_by else ''
		out.append('<option value="%s" %s>%s</option>' % (value, selected, label))
	out.append('</select>')
	out.append('</div>')

	# Include files checkbox
	out.append('<div class="treemap-control-group">')
	out.append('<label>')
	checked = 'checked' if config.include_files else ''
	out.append('<input type="checkbox" id="treemap-include-files" %s>' % checked)
	out.append('Include Files')
	out.append('</label>')
	out.append('</div>')

	# Refresh button
	out.append('<div class="treemap-control-group">')
	out.append('<button id="treemap-refresh" class="pointer">Refresh</button>')
	out.append('</div>')

	out.append('</div><!-- treemap-controls -->')

	return "\n".join(out)

def render_treemap_container(treemap_data, config):
	"""Render the main treemap visualization container."""
	out = []

	if 'error' in treemap_data:
		# Show error message
		out.append('<div class="treemap-error">')
		out.append(html_escape(treemap_data['error']))
		out.append('</div>')
	else:
		# Breadcrumb navigation
		out.append('<div class="treemap-breadcrumb" id="treemap-breadcrumb">')
		out.append(render_breadcrumb_navigation(treemap_data))
		out.append('</div>')

		# Treemap container
		out.append('<div class="treemap-container">')
		out.append('<div id="treemap-visualization" ')
		out.append('data-treemap="true" ')
		out.append('data-color-scheme="%s" ' % config.color_by)
		out.append('data-include-files="%s" ' % ('true' if config.include_files else 'false'))
		out.append('data-max-depth="%s">' % config.depth)
		out.append('</div>')
		out.append('</div>')

	return "\n".join(out)

def render_breadcrumb_navigation(treemap_data):
	"""Render breadcrumb navigation for current path."""
	out = []

	path = treemap_data.get('name', '/')
	if path == '/':
		out.append('<a href="#" class="treemap-breadcrumb-item" data-path="/">/</a>')
	else:
		# Split path and create breadcrumb items
		parts = path.strip('/').split('/')
		out.append('<a href="#" class="treemap-breadcrumb-item" data-path="/">/</a>')

		current_path = ''
		for part in parts:
			current_path += '/' + part
			out.append('<span class="treemap-breadcrumb-separator">›</span>')
			if current_path == path:
				out.append('<span class="treemap-breadcrumb-current">%s</span>' % html_escape(part))
			else:
				out.append('<a href="#" class="treemap-breadcrumb-item" data-path="%s">%s</a>' %
					(html_escape(current_path), html_escape(part)))

	return "\n".join(out)

def render_treemap_stats(treemap_data):
	"""Render treemap statistics panel."""
	out = []

	if 'error' not in treemap_data:
		out.append('<div class="treemap-stats">')

		# Total size
		total_size = treemap_data.get('total_size', 0)
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">%s</div>' % format_bytes(total_size))
		out.append('<div class="treemap-stat-label">Total Size</div>')
		out.append('</div>')

		# File count
		total_files = treemap_data.get('total_files', 0)
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">%s</div>' % format_number(total_files))
		out.append('<div class="treemap-stat-label">Files</div>')
		out.append('</div>')

		# Directory count
		total_dirs = treemap_data.get('total_dirs', 0)
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">%s</div>' % format_number(total_dirs))
		out.append('<div class="treemap-stat-label">Directories</div>')
		out.append('</div>')

		# Max depth
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">3</div>')
		out.append('<div class="treemap-stat-label">Max Depth</div>')
		out.append('</div>')

		out.append('</div><!-- treemap-stats -->')

		# Add color legend
		out.append('<div class="treemap-legend" id="treemap-legend">')
		out.append('</div>')

	return "\n".join(out)

def render_treemap_script(treemap_data, config):
	"""Render JavaScript initialization for treemap."""
	out = []

	out.append('<script type="text/javascript">')
	out.append('document.addEventListener(\'DOMContentLoaded\', function() {')
	out.append('  const treemapContainer = document.getElementById(\'treemap-visualization\');')
	out.append('  if (treemapContainer && treemapContainer.treemapInstance) {')
	out.append('    // Set initial data')
	out.append('    treemapContainer.treemapInstance.setData(%s);' % json.dumps(treemap_data))
	out.append('    ')
	out.append('    // Setup event listeners for controls')
	out.append('    setupTreemapControls(treemapContainer.treemapInstance);')
	out.append('    ')
	out.append('    // Setup navigation event listener')
	out.append('    treemapContainer.addEventListener(\'treemapNavigate\', function(e) {')
	out.append('      onTreemapNavigate(e.detail.path);')
	out.append('    });')
	out.append('  }')
	out.append('  ')
	out.append('  // Initialize legend')
	out.append('  updateLegend();')
	out.append('});')
	out.append('')
	out.append('function setupTreemapControls(treemap) {')
	out.append('  // Path input')
	out.append('  const pathInput = document.getElementById(\'treemap-path\');')
	out.append('  pathInput.addEventListener(\'change\', function() {')
	out.append('    updateTreemap();')
	out.append('  });')
	out.append('  ')
	out.append('  // Depth selector')
	out.append('  const depthSelect = document.getElementById(\'treemap-depth\');')
	out.append('  depthSelect.addEventListener(\'change\', function() {')
	out.append('    updateTreemap();')
	out.append('  });')
	out.append('  ')
	out.append('  // Color scheme selector')
	out.append('  const colorSelect = document.getElementById(\'treemap-color-scheme\');')
	out.append('  colorSelect.addEventListener(\'change\', function() {')
	out.append('    treemap.updateConfig({ colorScheme: this.value });')
	out.append('    updateLegend();')
	out.append('  });')
	out.append('  ')
	out.append('  // Include files checkbox')
	out.append('  const includeFilesCheckbox = document.getElementById(\'treemap-include-files\');')
	out.append('  includeFilesCheckbox.addEventListener(\'change\', function() {')
	out.append('    updateTreemap();')
	out.append('  });')
	out.append('  ')
	out.append('  // Refresh button')
	out.append('  const refreshButton = document.getElementById(\'treemap-refresh\');')
	out.append('  refreshButton.addEventListener(\'click\', function() {')
	out.append('    updateTreemap();')
	out.append('  });')
	out.append('}')
	out.append('')
	out.append('function updateTreemap() {')
	out.append('  const path = document.getElementById(\'treemap-path\').value;')
	out.append('  const depth = parseInt(document.getElementById(\'treemap-depth\').value);')
	out.append('  const includeFiles = document.getElementById(\'treemap-include-files\').checked;')
	out.append('  ')
	out.append('  // Update URL parameters')
	out.append('  const url = new URL(window.location);')
	out.append('  url.searchParams.set(\'path\', path);')
	out.append('  url.searchParams.set(\'depth\', depth);')
	out.append('  url.searchParams.set(\'include_files\', includeFiles ? \'1\' : \'0\');')
	out.append('  ')
	out.append('  // Reload page with new parameters')
	out.append('  window.location.href = url.toString();')
	out.append('}')
	out.append('')
	out.append('function onTreemapNavigate(path) {')
	out.append('  // Update path input and navigate')
	out.append('  document.getElementById(\'treemap-path\').value = path;')
	out.append('  updateTreemap();')
	out.append('}')
	out.append('')
	out.append('function updateLegend() {')
	out.append('  const colorScheme = document.getElementById(\'treemap-color-scheme\').value;')
	out.append('  const legend = document.getElementById(\'treemap-legend\');')
	out.append('  ')
	out.append('  const legends = {')
	out.append('    \'type\': [')
	out.append('      { color: \'var(--treemap-color-directory)\', label: \'Directory\' },')
	out.append('      { color: \'var(--treemap-color-image)\', label: \'Images\' },')
	out.append('      { color: \'var(--treemap-color-video)\', label: \'Videos\' },')
	out.append('      { color: \'var(--treemap-color-audio)\', label: \'Audio\' },')
	out.append('      { color: \'var(--treemap-color-document)\', label: \'Documents\' },')
	out.append('      { color: \'var(--treemap-color-archive)\', label: \'Archives\' },')
	out.append('      { color: \'var(--treemap-color-code)\', label: \'Code\' },')
	out.append('      { color: \'var(--treemap-color-other)\', label: \'Other\' }')
	out.append('    ],')
	out.append('    \'age\': [')
	out.append('      { color: \'var(--treemap-age-veryrecent)\', label: \'Very Recent (< 1 day)\' },')
	out.append('      { color: \'var(--treemap-age-recent)\', label: \'Recent (1-7 days)\' },')
	out.append('      { color: \'var(--treemap-age-medium)\', label: \'Medium (1-30 days)\' },')
	out.append('      { color: \'var(--treemap-age-old)\', label: \'Old (1-12 months)\' },')
	out.append('      { color: \'var(--treemap-age-veryold)\', label: \'Very Old (> 1 year)\' }')
	out.append('    ],')
	out.append('    \'size\': [')
	out.append('      { color: \'var(--treemap-size-tiny)\', label: \'Tiny (< 1 KB)\' },')
	out.append('      { color: \'var(--treemap-size-small)\', label: \'Small (1 KB - 1 MB)\' },')
	out.append('      { color: \'var(--treemap-size-medium)\', label: \'Medium (1 MB - 1 GB)\' },')
	out.append('      { color: \'var(--treemap-size-large)\', label: \'Large (1-10 GB)\' },')
	out.append('      { color: \'var(--treemap-size-huge)\', label: \'Huge (> 10 GB)\' }')
	out.append('    ]')
	out.append('  };')
	out.append('  ')
	out.append('  const legendItems = legends[colorScheme] || [];')
	out.append('  let html = \'\';')
	out.append('  legendItems.forEach(item => {')
	out.append('    html += `')
	out.append('    <div class="treemap-legend-item">')
	out.append('      <div class="treemap-legend-color" style="background-color: ${item.color}"></div>')
	out.append('      <span>${item.label}</span>')
	out.append('    </div>`;')
	out.append('  });')
	out.append('  ')
	out.append('  legend.innerHTML = html;')
	out.append('}')
	out.append('</script>')

	return "\n".join(out)

def format_bytes(bytes_value):
	"""Format bytes in human-readable format."""
	if bytes_value == 0:
		return '0 B'

	units = ['B', 'KB', 'MB', 'GB', 'TB']
	unit_index = 0
	size = float(bytes_value)

	while size >= 1024.0 and unit_index < len(units) - 1:
		size /= 1024.0
		unit_index += 1

	if unit_index == 0:
		return '%d %s' % (int(size), units[unit_index])
	else:
		return '%.1f %s' % (size, units[unit_index])

def format_number(number):
	"""Format number with thousands separator."""
	if number == 0:
		return '0'
	return '{:,}'.format(number)

def html_escape(text):
	"""Escape HTML special characters."""
	if text is None:
		return ''
	return (str(text)
		.replace('&', '&')
		.replace('<', '<')
		.replace('>', '>')
		.replace('"', '"')
		.replace("'", '&#x27;'))
// Add copy button to code blocks
document.addEventListener('DOMContentLoaded', function() {
  // Find all code blocks
  const codeBlocks = document.querySelectorAll('pre > code');

  codeBlocks.forEach(function(codeBlock) {
    const pre = codeBlock.parentElement;

    // Create wrapper if not already wrapped
    if (!pre.parentElement.classList.contains('code-block-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      // Create copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-code-button';
      copyButton.innerHTML = `
        <svg class="copy-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
          <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
        </svg>
        <svg class="check-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display:none;">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
        </svg>
      `;
      copyButton.setAttribute('aria-label', 'Copy code');
      copyButton.setAttribute('title', 'Copy code');

      // Add click event
      copyButton.addEventListener('click', function() {
        const code = codeBlock.textContent;
        navigator.clipboard.writeText(code).then(function() {
          // Show check icon
          const copyIcon = copyButton.querySelector('.copy-icon');
          const checkIcon = copyButton.querySelector('.check-icon');
          copyIcon.style.display = 'none';
          checkIcon.style.display = 'block';
          copyButton.classList.add('copied');

          // Reset after 2 seconds
          setTimeout(function() {
            copyIcon.style.display = 'block';
            checkIcon.style.display = 'none';
            copyButton.classList.remove('copied');
          }, 2000);
        }).catch(function(err) {
          console.error('Failed to copy code: ', err);
        });
      });

      wrapper.appendChild(copyButton);
    }
  });
});

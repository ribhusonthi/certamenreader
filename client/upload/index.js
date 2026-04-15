// Set default year to current year
document.getElementById('year').value = new Date().getFullYear();

function escapeHtml (str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getFormData () {
  const formData = new FormData();
  const fileInput = document.getElementById('file-input');
  const setName = document.getElementById('set-name').value.trim();
  const year = document.getElementById('year').value;
  const difficulty = document.getElementById('difficulty').value;

  if (!fileInput.files[0]) {
    throw new Error('Please select a file.');
  }
  if (!setName) {
    throw new Error('Please enter a set name.');
  }
  if (!year) {
    throw new Error('Please enter a year.');
  }

  formData.append('file', fileInput.files[0]);
  formData.append('setName', setName);
  formData.append('year', year);
  formData.append('difficulty', difficulty);
  return formData;
}

function setLoading (btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Processing...';
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}

// Preview button
document.getElementById('preview-btn').addEventListener('click', async () => {
  const btn = document.getElementById('preview-btn');
  const previewSection = document.getElementById('preview-section');
  const resultSection = document.getElementById('result-section');
  resultSection.classList.add('d-none');

  let formData;
  try {
    formData = getFormData();
  } catch (err) {
    alert(err.message);
    return;
  }

  setLoading(btn, true);

  try {
    const response = await fetch('/upload/api/preview', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      previewSection.classList.add('d-none');
      alert(data.error || 'Preview failed.');
      return;
    }

    const bonusLabel = data.bonusCount ? `, ${data.bonusCount} bonus set${data.bonusCount !== 1 ? 's' : ''}` : '';
    document.getElementById('preview-count').textContent = `${data.questionCount} tossup${data.questionCount !== 1 ? 's' : ''}${bonusLabel} found`;

    let html = '';

    if (data.questions && data.questions.length > 0) {
      html += '<div class="table-responsive"><table class="table table-sm table-striped">';
      html += '<thead><tr><th>#</th><th>Round</th><th>Question</th><th>Answer</th><th>Category</th><th>Boni</th></tr></thead><tbody>';
      for (const q of data.questions) {
        const truncQ = q.question.length > 200
          ? q.question.substring(0, 200) + '...'
          : q.question;
        html += `<tr>
          <td>${q.questionNumber}</td>
          <td>${escapeHtml(q.packetName)}</td>
          <td>${escapeHtml(truncQ)}</td>
          <td><strong>${escapeHtml(q.answer)}</strong></td>
          <td><span class="badge bg-secondary">${escapeHtml(q.category)}</span></td>
          <td>${q.bonusParts ? `${q.bonusParts} parts` : '<span class="text-muted">-</span>'}</td>
        </tr>`;
      }
      html += '</tbody></table></div>';

      if (data.questionCount > data.questions.length) {
        html += `<p class="text-muted">Showing first ${data.questions.length} of ${data.questionCount} questions.</p>`;
      }
    } else {
      html += '<p class="text-warning">No questions could be parsed. The file may not follow the expected format.</p>';
    }

    if (data.extractedTextPreview) {
      html += '<details class="mt-3"><summary class="text-muted">Extracted text preview</summary>';
      html += `<pre class="mt-2 p-2 bg-dark text-light rounded" style="max-height:300px;overflow:auto;white-space:pre-wrap">${escapeHtml(data.extractedTextPreview)}</pre>`;
      html += '</details>';
    }

    document.getElementById('preview-content').innerHTML = html;
    previewSection.classList.remove('d-none');
  } catch (err) {
    alert('An error occurred: ' + err.message);
  } finally {
    setLoading(btn, false);
  }
});

// Upload form submit
document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('upload-btn');
  const resultSection = document.getElementById('result-section');
  const resultAlert = document.getElementById('result-alert');

  let formData;
  try {
    formData = getFormData();
  } catch (err) {
    alert(err.message);
    return;
  }

  if (!confirm('Are you sure you want to upload this question set? The questions will be added to the database.')) {
    return;
  }

  setLoading(btn, true);

  try {
    const response = await fetch('/upload/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      resultAlert.className = 'alert alert-danger';
      resultAlert.innerHTML = `<strong>Upload failed:</strong> ${escapeHtml(data.error || 'Unknown error.')}`;
      if (data.extractedTextPreview) {
        resultAlert.innerHTML += `<details class="mt-2"><summary>Extracted text preview</summary><pre class="mt-1" style="white-space:pre-wrap">${escapeHtml(data.extractedTextPreview)}</pre></details>`;
      }
      resultSection.classList.remove('d-none');
      return;
    }

    resultAlert.className = 'alert alert-success';
    const bonusMsg = data.bonusCount ? ` and <strong>${data.bonusCount}</strong> bonus set${data.bonusCount !== 1 ? 's' : ''}` : '';
    let html = `<strong>Upload successful!</strong> Added <strong>${data.questionCount}</strong> tossup${data.questionCount !== 1 ? 's' : ''}${bonusMsg} to set "<strong>${escapeHtml(data.setName)}</strong>".`;

    if (data.sampleQuestions && data.sampleQuestions.length > 0) {
      html += '<div class="mt-2"><small class="text-muted">Sample questions:</small><ul class="mt-1">';
      for (const sq of data.sampleQuestions) {
        html += `<li><em>${escapeHtml(sq.question)}</em> &mdash; <strong>${escapeHtml(sq.answer)}</strong> [${escapeHtml(sq.category)}]</li>`;
      }
      html += '</ul></div>';
    }

    resultAlert.innerHTML = html;
    resultSection.classList.remove('d-none');

    // Reset form
    document.getElementById('upload-form').reset();
    document.getElementById('year').value = new Date().getFullYear();
    document.getElementById('preview-section').classList.add('d-none');
  } catch (err) {
    resultAlert.className = 'alert alert-danger';
    resultAlert.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message)}`;
    resultSection.classList.remove('d-none');
  } finally {
    setLoading(btn, false);
  }
});

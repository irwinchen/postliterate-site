
import os
import re
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import openai

class LinkSummarizer:
    def __init__(self, vault_path, openai_key, email_config=None):
        """Initialize with path to Obsidian vault and OpenAI API key."""
        self.vault_path = vault_path
        openai.api_key = openai_key
        self.email_config = email_config

    def get_latest_daily_note(self):
        """Find the most recent daily note in the vault."""
        daily_notes_path = os.path.join(self.vault_path, "Daily")
        if not os.path.exists(daily_notes_path):
            return None
        
        files = os.listdir(daily_notes_path)
        # Assuming daily notes format: YYYY-MM-DD.md
        date_files = [f for f in files if re.match(r'\d{4}-\d{2}-\d{2}\.md', f)]
        if not date_files:
            return None
            
        latest_file = max(date_files)
        return os.path.join(daily_notes_path, latest_file)

    def extract_links(self, file_path):
        """Extract all URLs from the markdown file."""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Match both markdown links and raw URLs
        md_links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', content)
        raw_urls = re.findall(r'(?<!\[)(?<!\()]http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', content)
        
        links = [url for _, url in md_links] + raw_urls
        return links

    def fetch_webpage_content(self, url):
        """Fetch and extract main content from webpage."""
        try:
            response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.decompose()
            
            # Get text content
            text = soup.get_text()
            lines = (line.strip() for line in text.splitlines())
            content = ' '.join(line for line in lines if line)
            return content[:4000]  # Limit content length
        except Exception as e:
            return f"Error fetching content: {str(e)}"

    def summarize_content(self, content, url):
        """Use OpenAI API to summarize webpage content."""
        try:
            response = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "Summarize the following webpage content in 2-3 sentences, focusing on the main points."},
                    {"role": "user", "content": f"URL: {url}\n\nContent: {content}"}
                ]
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Error generating summary: {str(e)}"

    def send_email_report(self, summaries):
        """Send email with link summaries."""
        if not self.email_config:
            return
        
        msg = MIMEMultipart()
        msg['From'] = self.email_config['from']
        msg['To'] = self.email_config['to']
        msg['Subject'] = f"Daily Link Summaries - {datetime.now().strftime('%Y-%m-%d')}"
        
        body = "Here are summaries of the links from your daily note:\n\n"
        for url, summary in summaries.items():
            body += f"URL: {url}\nSummary: {summary}\n\n"
        
        msg.attach(MIMEText(body, 'plain'))
        
        with smtplib.SMTP(self.email_config['smtp_server'], self.email_config['smtp_port']) as server:
            server.starttls()
            server.login(self.email_config['username'], self.email_config['password'])
            server.send_message(msg)

    def update_note_with_summaries(self, file_path, summaries):
        """Update the original note with summaries under each link."""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        for url, summary in summaries.items():
            # Add summary under the link
            content = content.replace(
                url,
                f"{url}\n> Summary: {summary}"
            )
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)

    def process_daily_links(self):
        """Main function to process links and generate summaries."""
        file_path = self.get_latest_daily_note()
        if not file_path:
            return "No daily note found"
        
        links = self.extract_links(file_path)
        if not links:
            return "No links found in the daily note"
        
        summaries = {}
        for url in links:
            content = self.fetch_webpage_content(url)
            summary = self.summarize_content(content, url)
            summaries[url] = summary
        
        # Update the note with summaries
        self.update_note_with_summaries(file_path, summaries)
        
        # Send email if configured
        if self.email_config:
            self.send_email_report(summaries)
        
        return summaries

# Example usage:
email_config = {
    'from': 'your-email@example.com',
    'to': 'your-email@example.com',
    'smtp_server': 'smtp.gmail.com',
    'smtp_port': 587,
    'username': 'your-email@example.com',
    'password': 'your-app-specific-password'
}

summarizer = LinkSummarizer(
    vault_path="/path/to/your/obsidian/vault",
    openai_key="your-openai-api-key",
    email_config=email_config  # Optional
)

summaries = summarizer.process_daily_links()

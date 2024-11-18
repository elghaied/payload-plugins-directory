export default async function Page() {
    const headers = {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
       "X-GitHub-Api-Version": "2022-11-28"
      };
    const test = await fetch(' https://api.github.com/rate_limit',{ headers });
    console.log(test)
    return (
        <div>
            <h1>Test</h1>
        </div>
    );
}
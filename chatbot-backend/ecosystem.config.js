module.exports = {
    apps: [{
        name: "chatbot-backend",
        script: "npm",
        args: "run dev",
        instances: 1,
        exec_mode: "fork",
        env: {
            NODE_ENV: "development",
        }
    }]
}
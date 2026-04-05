import React from 'react';
import { Paper, Typography } from '@material-ui/core';

export default function ArtifactFrame({ title, children }) {
    return (
        <Paper
            elevation={0}
            style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.8)',
                border: '1px solid rgba(0,0,0,0.06)',
                backdropFilter: 'blur(6px)'
            }}
        >
            {title ? (
                <Typography
                    variant="caption"
                    style={{
                        display: 'block',
                        fontWeight: 600,
                        letterSpacing: 0.2,
                        marginBottom: 8,
                        color: '#334e68'
                    }}
                >
                    {title}
                </Typography>
            ) : null}
            {children}
        </Paper>
    );
}

